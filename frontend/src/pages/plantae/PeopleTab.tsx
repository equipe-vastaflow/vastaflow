import { useState, type ReactNode } from 'react';
import {
  api,
  type PlantaeList,
  type PlantaePeopleQuery,
  type PlantaePerson,
} from '../../api/client';
import { EMPTY, maskedDocument, personTypeLabel, searchProblem } from './plantae-format';
import { FormError, LoadMore, QueryFeedback } from './plantae-ui';
import { appendList, usePlantaeQuery } from './use-plantae-query';

/**
 * Pessoas cadastradas no Plantae (`people`): clientes, fornecedores e
 * colaboradores, SEM distincao - a API nao informa o papel de cada cadastro, e a
 * tela nao o inventa. CPF/CNPJ chega MASCARADO pelo backend.
 *
 * A `busca` e opcional e fica so no estado do componente: nunca na URL da pagina,
 * no historico do navegador nem em armazenamento local.
 */
export function PeopleTab(): ReactNode {
  const [busca, setBusca] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const { loaded, error, busy, consultar, carregarMais } = usePlantaeQuery<
    PlantaePeopleQuery,
    PlantaeList<PlantaePerson>
  >(api.plantae.people, appendList);

  function submit(): void {
    const problema = searchProblem(busca);
    setFormError(problema);
    if (!problema) {
      const termo = busca.trim();
      consultar(termo === '' ? {} : { busca: termo });
    }
  }

  const items = loaded?.result.data ?? [];

  return (
    <section aria-labelledby="plantae-pessoas-titulo">
      <h2 id="plantae-pessoas-titulo" className="sr-only">
        Pessoas
      </h2>

      <p className="muted">
        O Plantae não informa diretamente se cada cadastro é cliente ou fornecedor.
      </p>

      <form
        className="card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="plantae-pessoas-busca">Buscar (opcional)</label>
            <input
              id="plantae-pessoas-busca"
              type="search"
              autoComplete="off"
              maxLength={100}
              value={busca}
              aria-describedby="plantae-pessoas-busca-ajuda"
              onChange={(event) => {
                setBusca(event.target.value);
              }}
            />
            <span id="plantae-pessoas-busca-ajuda" className="muted">
              Nome, razão social ou CPF/CNPJ, de 2 a 100 caracteres.
            </span>
          </div>
        </div>

        <FormError message={formError} />

        <div className="row-actions">
          <button type="submit" className="button" disabled={busy !== 'idle'}>
            {busy === 'consultando' ? 'Consultando…' : 'Consultar'}
          </button>
        </div>
      </form>

      <QueryFeedback busy={busy} error={error} />

      {loaded && (
        <>
          <p className="muted" role="status">
            {loaded.query.busca === undefined ? 'Sem busca' : 'Com busca'} · {items.length}{' '}
            {items.length === 1 ? 'cadastro' : 'cadastros'}
          </p>

          {items.length === 0 ? (
            <p className="card muted">Nenhum cadastro encontrado.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">Razão social</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">CPF/CNPJ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((pessoa, index) => (
                    <tr key={`${String(pessoa.pessoa_id)}-${String(index)}`}>
                      <td className="cell-wrap">{pessoa.nome?.trim() || EMPTY}</td>
                      <td className="cell-wrap">{pessoa.razao_social?.trim() || EMPTY}</td>
                      <td>{personTypeLabel(pessoa.tipo_pessoa)}</td>
                      <td className="mono">{maskedDocument(pessoa) ?? EMPTY}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <LoadMore
            pagination={loaded.result.pagination}
            busy={busy}
            itens="cadastros"
            onLoadMore={() => {
              const cursor = loaded.result.pagination.nextCursor;
              if (cursor) {
                carregarMais({ ...loaded.query, cursor });
              }
            }}
          />
        </>
      )}
    </section>
  );
}
