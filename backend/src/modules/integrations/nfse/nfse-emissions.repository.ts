import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { isUniqueViolation } from '../../../database/unique-violation';
import type { NfseEmissionInput } from './nfse-dps';
import { NfseEmission, NfseEmissionStatus } from './nfse-emission.entity';

export interface NewEmission {
  readonly usuarioId: string;
  readonly canal: string;
  readonly ambiente: number;
  readonly serie: string;
  readonly dados: NfseEmissionInput;
  readonly confirmHash: string;
  readonly confirmExpiresAt: Date;
  /** Recebe o numero reservado e devolve o `Id` da DPS e o hash do resumo. */
  readonly identify: (numeroDps: number) => { readonly dpsId: string; readonly resumoHash: string };
}

export interface Resolution {
  readonly status: NfseEmissionStatus;
  readonly chaveAcesso?: string | null;
  readonly nfseXml?: string | null;
  readonly erroCodigo?: string | null;
  readonly erroMensagem?: string | null;
}

const NUMBER_RETRIES = 12;

/**
 * Unico acesso a `nfse_emissions`. TODA transicao de estado e um UPDATE condicionado ao estado de
 * origem: o banco decide quem ganha uma corrida (confirmacao dupla, Telegram e WhatsApp ao mesmo
 * tempo, consulta e confirmacao). Nenhuma transicao le, decide e grava em passos separados.
 */
@Injectable()
export class NfseEmissionsRepository {
  constructor(
    @InjectRepository(NfseEmission)
    private readonly repository: Repository<NfseEmission>,
  ) {}

  /**
   * Reserva o proximo numero de DPS e cria o pedido. Dois pedidos simultaneos podem calcular o mesmo
   * "proximo": o indice UNICO `(ambiente, serie, numero)` derruba um deles, que tenta de novo.
   */
  async createPending(input: NewEmission): Promise<NfseEmission> {
    for (let attempt = 0; attempt < NUMBER_RETRIES; attempt += 1) {
      const last = await this.repository
        .createQueryBuilder('e')
        .select('MAX(e.numeroDps)', 'max')
        .where('e.ambiente = :ambiente AND e.serie = :serie', {
          ambiente: input.ambiente,
          serie: input.serie,
        })
        .getRawOne<{ max: string | number | null }>();
      const numeroDps = Number(last?.max ?? 0) + 1;
      const { dpsId, resumoHash } = input.identify(numeroDps);
      try {
        return await this.repository.save(
          this.repository.create({
            usuarioId: input.usuarioId,
            canal: input.canal,
            status: NfseEmissionStatus.AguardandoConfirmacao,
            ambiente: input.ambiente,
            serie: input.serie,
            numeroDps,
            dpsId,
            dados: input.dados,
            resumoHash,
            confirmHash: input.confirmHash,
            confirmExpiresAt: input.confirmExpiresAt,
            confirmadoEm: null,
            tentativas: 0,
            ultimaTentativaEm: null,
            chaveAcesso: null,
            nfseXml: null,
            erroCodigo: null,
            erroMensagem: null,
          }),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }
    throw new Error('Nao foi possivel reservar um numero de DPS');
  }

  /** Pedidos ainda aguardando confirmacao da pessoa passam a `EXPIRADA` (um pedido novo substitui o antigo). */
  async expirePendingOf(usuarioId: string): Promise<void> {
    await this.repository.update(
      { usuarioId, status: NfseEmissionStatus.AguardandoConfirmacao },
      { status: NfseEmissionStatus.Expirada, confirmHash: null },
    );
  }

  async findOfUser(
    usuarioId: string,
    ambiente: number,
    serie: string,
    numeroDps: number,
  ): Promise<NfseEmission | null> {
    return this.repository.findOne({ where: { usuarioId, ambiente, serie, numeroDps } });
  }

  async findById(id: string): Promise<NfseEmission | null> {
    return this.repository.findOne({ where: { id } });
  }

  async listRecent(usuarioId: string, limit: number): Promise<NfseEmission[]> {
    return this.repository.find({
      where: { usuarioId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * CONSOME a confirmacao: `AGUARDANDO_CONFIRMACAO -> ENVIANDO`, uma unica vez. Condicionada ao
   * hash do codigo, ao dono, ao canal e ao prazo. `true` so para quem ganhou; qualquer outra
   * chamada (repetida, concorrente, de outro canal, vencida) recebe `false` e NAO envia nada.
   */
  async consumeConfirmation(
    id: string,
    usuarioId: string,
    canal: string,
    confirmHash: string,
    now: Date,
  ): Promise<boolean> {
    // `update` com criterio de objeto: portavel entre MySQL e Oracle (sem SQL cru com nome de coluna).
    const result = await this.repository.update(
      {
        id,
        usuarioId,
        canal,
        status: NfseEmissionStatus.AguardandoConfirmacao,
        confirmHash,
        confirmExpiresAt: MoreThan(now),
      },
      {
        status: NfseEmissionStatus.Enviando,
        confirmHash: null,
        confirmadoEm: now,
        tentativas: 1,
        ultimaTentativaEm: now,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  /** `AGUARDANDO_CONFIRMACAO -> EXPIRADA` (codigo vencido). */
  async expire(id: string): Promise<void> {
    await this.repository.update(
      { id, status: NfseEmissionStatus.AguardandoConfirmacao },
      { status: NfseEmissionStatus.Expirada, confirmHash: null },
    );
  }

  /** `from -> resolucao`, condicionada ao estado de origem. `true` se a transicao aconteceu. */
  async transition(id: string, from: NfseEmissionStatus, resolution: Resolution): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: from },
      {
        status: resolution.status,
        ...(resolution.chaveAcesso === undefined ? {} : { chaveAcesso: resolution.chaveAcesso }),
        ...(resolution.nfseXml === undefined ? {} : { nfseXml: resolution.nfseXml }),
        ...(resolution.erroCodigo === undefined ? {} : { erroCodigo: resolution.erroCodigo }),
        ...(resolution.erroMensagem === undefined ? {} : { erroMensagem: resolution.erroMensagem }),
      },
    );
    return (result.affected ?? 0) === 1;
  }

  /**
   * `ENVIANDO` parado ha mais que `olderThan` (o processo caiu no meio do envio) vira `INCERTA`:
   * nao se sabe se a Sefin recebeu. Nunca volta para "aguardando" nem e reenviado.
   */
  async markStaleAsUncertain(usuarioId: string, olderThan: Date): Promise<void> {
    await this.repository.update(
      { usuarioId, status: NfseEmissionStatus.Enviando, ultimaTentativaEm: LessThan(olderThan) },
      {
        status: NfseEmissionStatus.Incerta,
        erroCodigo: 'processo_interrompido',
        erroMensagem: null,
      },
    );
  }
}
