import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import {
  LeaseLostError,
  type SessionRepository,
  type StoredItem,
  type WriteBatch,
} from './session-repository.js';

export interface MysqlOptions {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

const QUERY_TIMEOUT_MS = 15_000;
/** Ids por consulta `IN (...)`: o Baileys pede poucos de cada vez; o limite protege o tamanho do SQL. */
const MAX_IDS_PER_QUERY = 500;
const ER_DUP_ENTRY = 1062;
const ER_LOCK_DEADLOCK = 1213;

interface MysqlError {
  readonly errno?: number;
}
const errno = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null ? (error as MysqlError).errno : undefined;

/**
 * Acesso ao MySQL das tabelas `whatsapp_auth_state` e `whatsapp_auth_lock` (criadas por migration do BACKEND).
 *
 * - O usuario de banco do gateway deve ter permissao SO nessas duas tabelas (ver docs/whatsapp-gateway.md);
 * - tudo parametrizado (nenhum valor concatenado em SQL); transacoes curtas; timeout por consulta;
 * - a validade da trava usa o RELOGIO DO BANCO (`NOW(6)`), nao o da maquina do gateway;
 * - toda escrita confere, na MESMA transacao e com `FOR UPDATE`, que a trava ainda e do dono: um dono antigo nao grava;
 * - os erros do driver podem citar host/usuario/SQL: quem usa esta classe os troca por mensagens fixas.
 */
export class MysqlSessionRepository implements SessionRepository {
  private readonly pool: Pool;

  constructor(options: MysqlOptions) {
    this.pool = mysql.createPool({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 4,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      multipleStatements: false,
    });
  }

  private async tx<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback().catch(() => undefined);
      throw error;
    } finally {
      conn.release();
    }
  }

  private async select(
    conn: Pick<PoolConnection, 'query'>,
    sql: string,
    values: unknown[],
  ): Promise<RowDataPacket[]> {
    const [rows] = await conn.query<RowDataPacket[]>({ sql, values, timeout: QUERY_TIMEOUT_MS });
    return rows;
  }

  private async run(
    conn: Pick<PoolConnection, 'query'>,
    sql: string,
    values: unknown[],
  ): Promise<ResultSetHeader> {
    const [result] = await conn.query<ResultSetHeader>({ sql, values, timeout: QUERY_TIMEOUT_MS });
    return result;
  }

  // ---------------------------------------------------------------- trava

  async acquireLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      return await this.tx(async (conn) => {
        const rows = await this.select(
          conn,
          'SELECT `owner`, (`lease_until` < NOW(6)) AS `expired` FROM `whatsapp_auth_lock` WHERE `session_id` = ? FOR UPDATE',
          [sessionId],
        );
        const current = rows[0];
        if (current === undefined) {
          await this.run(
            conn,
            'INSERT INTO `whatsapp_auth_lock` (`session_id`, `owner`, `lease_until`, `generation`) VALUES (?, ?, NOW(6) + INTERVAL ? MICROSECOND, 1)',
            [sessionId, owner, ttlMs * 1000],
          );
          return true;
        }
        if (current.owner === owner || Number(current.expired) === 1) {
          await this.run(
            conn,
            'UPDATE `whatsapp_auth_lock` SET `owner` = ?, `lease_until` = NOW(6) + INTERVAL ? MICROSECOND, `generation` = `generation` + 1 WHERE `session_id` = ?',
            [owner, ttlMs * 1000, sessionId],
          );
          return true;
        }
        return false;
      });
    } catch (error) {
      // Duas instancias criando a primeira linha ao mesmo tempo: quem perdeu a corrida NAO tem a trava.
      if (errno(error) === ER_DUP_ENTRY || errno(error) === ER_LOCK_DEADLOCK) {
        return false;
      }
      throw error;
    }
  }

  async renewLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean> {
    const result = await this.run(
      this.pool,
      'UPDATE `whatsapp_auth_lock` SET `lease_until` = NOW(6) + INTERVAL ? MICROSECOND WHERE `session_id` = ? AND `owner` = ? AND `lease_until` > NOW(6)',
      [ttlMs * 1000, sessionId, owner],
    );
    return result.affectedRows === 1;
  }

  async releaseLease(sessionId: string, owner: string): Promise<void> {
    await this.run(
      this.pool,
      'UPDATE `whatsapp_auth_lock` SET `lease_until` = NOW(6) - INTERVAL 1 SECOND WHERE `session_id` = ? AND `owner` = ?',
      [sessionId, owner],
    );
  }

  /** Dentro da transacao: a trava e deste dono e ainda vale? Senao, nada e escrito. */
  private async assertLease(conn: PoolConnection, sessionId: string, owner: string): Promise<void> {
    const rows = await this.select(
      conn,
      'SELECT 1 AS `ok` FROM `whatsapp_auth_lock` WHERE `session_id` = ? AND `owner` = ? AND `lease_until` > NOW(6) FOR UPDATE',
      [sessionId, owner],
    );
    if (rows.length === 0) {
      throw new LeaseLostError();
    }
  }

  // ---------------------------------------------------------------- estado

  async readItems(sessionId: string, type: string, ids: readonly string[]): Promise<StoredItem[]> {
    const items: StoredItem[] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_QUERY) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_QUERY);
      const rows = await this.select(
        this.pool,
        'SELECT `item_id`, `payload` FROM `whatsapp_auth_state` WHERE `session_id` = ? AND `item_type` = ? AND `item_id` IN (?)',
        [sessionId, type, chunk],
      );
      for (const row of rows) {
        items.push({ type, id: String(row.item_id), payload: Buffer.from(row.payload as Buffer) });
      }
    }
    return items;
  }

  async countItems(sessionId: string): Promise<number> {
    const rows = await this.select(
      this.pool,
      'SELECT COUNT(*) AS `n` FROM `whatsapp_auth_state` WHERE `session_id` = ?',
      [sessionId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async writeBatch(sessionId: string, owner: string, batch: WriteBatch): Promise<void> {
    await this.tx(async (conn) => {
      await this.assertLease(conn, sessionId, owner);
      for (const item of batch.upserts) {
        await this.run(
          conn,
          'INSERT INTO `whatsapp_auth_state` (`session_id`, `item_type`, `item_id`, `payload`) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `payload` = VALUES(`payload`)',
          [sessionId, item.type, item.id, item.payload],
        );
      }
      for (const ref of batch.deletes) {
        await this.run(
          conn,
          'DELETE FROM `whatsapp_auth_state` WHERE `session_id` = ? AND `item_type` = ? AND `item_id` = ?',
          [sessionId, ref.type, ref.id],
        );
      }
    });
  }

  async deleteSession(sessionId: string, owner: string): Promise<void> {
    await this.tx(async (conn) => {
      await this.assertLease(conn, sessionId, owner);
      await this.run(conn, 'DELETE FROM `whatsapp_auth_state` WHERE `session_id` = ?', [sessionId]);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
