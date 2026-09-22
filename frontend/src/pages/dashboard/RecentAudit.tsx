import type { ReactNode } from 'react';
import type { DashboardAuditEvent } from '../../api/client';
import { formatDateTime } from '../users/format';

/**
 * Eventos de auditoria mais recentes.
 *
 * O backend nao tem campo de "alvo" no AuditLog - quando existir, entra como
 * mais uma coluna aqui. Ate la a `descricao` e o que identifica o alvo.
 */
export function RecentAudit({
  eventos,
  total,
}: {
  eventos: DashboardAuditEvent[];
  total: number;
}): ReactNode {
  return (
    <section aria-labelledby="titulo-auditoria" id="auditoria">
      <div className="section-header">
        <h2 id="titulo-auditoria">Auditoria recente</h2>
        {/* Diz quantos estao a vista e quantos existem: sem isto, "128 eventos"
            sugeriria que da para navegar por todos - e nao ha tela para isso. */}
        <span className="muted">
          {eventos.length === 0
            ? 'Nenhum evento registrado'
            : `Mostrando os ${eventos.length} mais recentes de ${total} eventos registrados`}
        </span>
      </div>

      {eventos.length === 0 ? (
        <p className="card muted">
          Nenhum evento registrado ainda. As ações do sistema aparecem aqui conforme acontecem.
        </p>
      ) : (
        <div className="card table-wrapper">
          <table className="table">
            <caption className="sr-only">
              Eventos de auditoria mais recentes, do mais novo para o mais antigo
            </caption>
            <thead>
              <tr>
                <th scope="col">Ação</th>
                <th scope="col">Módulo</th>
                <th scope="col">Responsável</th>
                <th scope="col">Descrição</th>
                <th scope="col">Data/hora</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((evento) => (
                <tr key={evento.id}>
                  <td>
                    <span className="badge">{evento.acao}</span>
                  </td>
                  <td>{evento.modulo}</td>
                  <td>{evento.usuario?.nome ?? <span className="muted">Não identificado</span>}</td>
                  <td>{evento.descricao}</td>
                  <td>{formatDateTime(evento.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
