import { useCallback, useEffect, useRef, useState } from 'react';
import { isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { describePlantaeError } from './plantae-errors';

export type PlantaeBusy = 'idle' | 'consultando' | 'carregando-mais';

/** Consulta aplicada (sem cursor) e tudo o que ja foi carregado para ela. */
export interface PlantaeLoaded<Q, R> {
  query: Q;
  result: R;
}

export interface PlantaeQueryState<Q, R> {
  loaded: PlantaeLoaded<Q, R> | null;
  error: string | null;
  busy: PlantaeBusy;
  /** Nova consulta: descarta o que havia. */
  consultar: (query: Q) => void;
  /**
   * Proxima pagina: recebe a consulta COM o cursor e acrescenta o resultado com
   * `merge`. A consulta guardada continua a original (sem cursor).
   */
  carregarMais: (queryComCursor: Q) => void;
}

/**
 * Estado de uma consulta ao Plantae, igual em todas as abas:
 *
 * - so chama quando `consultar`/`carregarMais` e chamado (nenhum efeito consulta
 *   sozinho, nada de polling);
 * - uma chamada por vez: a trava e sincrona, porque o `disabled` do botao so vale
 *   depois do proximo render e dois cliques no mesmo tick disparariam duas;
 * - resposta de uma consulta antiga, ou que chega depois de a aba sair da tela, e
 *   descartada;
 * - o resultado mora so neste estado (memoria do componente): some ao desmontar;
 * - erro vira mensagem amigavel (`describePlantaeError`), nunca o texto do backend;
 *   sessao expirada encerra o login.
 *
 * `fetcher` e `merge` devem ser estaveis (funcoes de modulo).
 */
export function usePlantaeQuery<Q, R>(
  fetcher: (token: string, query: Q) => Promise<R>,
  merge: (anterior: R, proxima: R) => R,
): PlantaeQueryState<Q, R> {
  const { token, logout } = useAuth();
  const [loaded, setLoaded] = useState<PlantaeLoaded<Q, R> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PlantaeBusy>('idle');
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const run = useCallback(
    (query: Q, mode: 'nova' | 'mais'): void => {
      if (!token || inFlight.current) {
        return;
      }
      inFlight.current = true;
      const current = ++generation.current;
      setBusy(mode === 'nova' ? 'consultando' : 'carregando-mais');
      setError(null);
      if (mode === 'nova') {
        setLoaded(null);
      }

      fetcher(token, query)
        .then((result) => {
          if (current !== generation.current) {
            return;
          }
          setLoaded((anterior) =>
            mode === 'mais' && anterior
              ? { query: anterior.query, result: merge(anterior.result, result) }
              : { query, result },
          );
        })
        .catch((failure: unknown) => {
          if (current !== generation.current) {
            return;
          }
          if (isSessionExpired(failure)) {
            void logout();
          }
          setError(describePlantaeError(failure));
        })
        .finally(() => {
          inFlight.current = false;
          if (current === generation.current) {
            setBusy('idle');
          }
        });
    },
    [token, logout, fetcher, merge],
  );

  const consultar = useCallback(
    (query: Q) => {
      run(query, 'nova');
    },
    [run],
  );
  const carregarMais = useCallback(
    (queryComCursor: Q) => {
      run(queryComCursor, 'mais');
    },
    [run],
  );

  return { loaded, error, busy, consultar, carregarMais };
}

/** `merge` das listagens: acrescenta os itens e fica com a paginacao mais recente. */
export function appendList<T extends { data: unknown[]; pagination: unknown }>(
  anterior: T,
  proxima: T,
): T {
  return { ...proxima, data: [...anterior.data, ...proxima.data] };
}
