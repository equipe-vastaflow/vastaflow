import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regras ESTATICAS do limite de tentativas na troca de senha (nginx). A rota exige a senha atual, entao
 * um token roubado serviria para adivinha-la: o limite fino precisa existir nos dois ingressos (HTTP e
 * HTTPS), que compartilham o mesmo snippet. Roda sem Docker; o teste de execucao do nginx e o de
 * `infra/https/test-https.sh`.
 */
const ROOT = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const semComentarios = (texto: string): string =>
  texto
    .split(/\r?\n/)
    .filter((linha) => !/^\s*#/.test(linha))
    .join('\n');

/** Corpo do `location` com este cabecalho, ate a chave de fechamento (sem aninhamento neste arquivo). */
function bloco(conf: string, cabecalho: string): string {
  const inicio = conf.indexOf(cabecalho);
  expect(inicio).toBeGreaterThanOrEqual(0);
  const fim = conf.indexOf('}', inicio);
  return conf.slice(inicio, fim + 1);
}

describe('Limite de tentativas na troca de senha (nginx)', () => {
  const zonas = semComentarios(read('frontend/nginx/conf.d/00-rate-limit.conf'));
  const app = semComentarios(read('frontend/nginx/snippets/vastaflow-app.conf'));
  const rota = bloco(app, 'location = /api/auth/change-password');

  it('ha uma zona propria de 5 requisicoes por minuto por IP', () => {
    expect(zonas).toMatch(
      /limit_req_zone \$binary_remote_addr zone=vastaflow_password:\d+m rate=5r\/m;/,
    );
  });

  it('a rota usa essa zona, com rajada pequena e sem o limite generico da API', () => {
    expect(rota).toMatch(/limit_req zone=vastaflow_password burst=3 nodelay;/);
    expect(rota).not.toContain('vastaflow_api');
  });

  it('a rota e exata e entrega ao backend a rota certa, com corpo pequeno', () => {
    expect(rota).toContain('rewrite ^ /auth/change-password break;');
    expect(rota).toContain('proxy_pass $backend_upstream;');
    expect(rota).toMatch(/client_max_body_size 8k;/);
  });

  it('a rota nao usa a zona do login (uma troca nao consome a cota de login)', () => {
    expect(rota).not.toContain('vastaflow_auth');
    expect(bloco(app, 'location = /api/auth/login')).not.toContain('vastaflow_password');
  });

  it('o ingress HTTP e o HTTPS usam o mesmo snippet (nenhum fica sem o limite)', () => {
    expect(semComentarios(read('frontend/nginx/conf.d/vastaflow.conf'))).toContain(
      'include /etc/nginx/snippets/vastaflow-app.conf',
    );
    expect(semComentarios(read('infra/https/vastaflow-https.conf.template'))).toContain(
      'include /etc/nginx/snippets/vastaflow-app.conf',
    );
  });
});
