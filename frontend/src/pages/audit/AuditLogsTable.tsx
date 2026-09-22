import type { ReactNode } from 'react';
import type { AuditLogEntry } from '../../api/client';
import { formatDateTime } from '../users/format';

/**
 * Quem executou a acao.
 *
 * Nome em destaque e e-mail abaixo: o nome identifica, o e-mail desempata
 * homonimos. Sem responsavel identificado, diz o porque em vez de deixar a
 * celula vazia.
 */
function ActorCell({ evento }: { evento: AuditLogEntry }): ReactNode {
  if (evento.usuario) {
    return (
      <>
        <span>{evento.usuario.nome}</span>
        <br />
        <span className="muted actor-email">{evento.usuario.email}</span>
      </>
    );
  }

  // Sem usuario no evento (ex.: login com e-mail inexistente).
  if (evento.usuarioId === null) {
    return <span className="muted">Não identificado</span>;
  }

  // Ha usuarioId, mas o usuario nao existe mais: mostra o id para rastrear.
  return (
    <span className="muted mono" title={evento.usuarioId}>
      Usuário removido ({evento.usuarioId.slice(0, 8)})
    </span>
  );
}

/**
 * Tabela de eventos. Mostra apenas os campos da tela: data/hora, responsavel,
 * acao, modulo e descricao.
 *
 * `ip` e `metadados` vem na resposta da API, mas NAO sao exibidos - a descricao
 * ja identifica a operacao, e esses dois campos nao sao necessarios aqui.
 */
export function AuditLogsTable({ eventos }: { eventos: AuditLogEntry[] }): ReactNode {
  return (
    <div className="card table-wrapper">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Data/hora</th>
            <th scope="col">Responsável</th>
            <th scope="col">Ação</th>
            <th scope="col">Módulo</th>
            <th scope="col">Descrição</th>
          </tr>
        </thead>
        <tbody>
          {eventos.map((evento) => (
            <tr key={evento.id}>
              <td>{formatDateTime(evento.createdAt)}</td>
              <td>
                <ActorCell evento={evento} />
              </td>
              <td>
                <span className="badge">{evento.acao}</span>
              </td>
              <td>{evento.modulo}</td>
              <td>{evento.descricao}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
