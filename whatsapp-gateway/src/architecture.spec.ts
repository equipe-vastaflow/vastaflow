import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const SRC = join(import.meta.dirname, '..', 'src');

function fontes(): { arquivo: string; codigo: string }[] {
  return readdirSync(SRC)
    .filter((a) => a.endsWith('.ts') && !a.endsWith('.spec.ts'))
    .map((arquivo) => ({ arquivo, codigo: readFileSync(join(SRC, arquivo), 'utf8') }));
}
const semComentarios = (codigo: string): string =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsDe = (codigo: string): string[] =>
  [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem ?? '');

const FONTES = fontes();
const quem = (padrao: RegExp): string[] =>
  FONTES.filter(({ codigo }) => padrao.test(semComentarios(codigo)))
    .map(({ arquivo }) => arquivo)
    .sort();

describe('Arquitetura do gateway', () => {
  it('ha fontes para verificar', () => {
    assert.ok(FONTES.length >= 10);
  });

  it('SO o adaptador importa o Baileys; o nucleo nao conhece a biblioteca', () => {
    const importam = FONTES.filter(({ codigo }) =>
      importsDe(codigo).some((o) => o.startsWith('@whiskeysockets/baileys')),
    ).map(({ arquivo }) => arquivo);

    assert.deepEqual(importam, ['baileys-socket.ts']);
  });

  it('SO o cliente do backend usa fetch/rede HTTP; ninguem mais abre conexao', () => {
    assert.deepEqual(quem(/\bfetch\(|\bfetchFn\b/), ['ingest-client.ts']);
    assert.deepEqual(quem(/from 'node:(https?|net|tls|dgram|dns)'/), []);
  });

  it('SO config.ts e main.ts leem process.env; nada usa console', () => {
    assert.deepEqual(quem(/process\.env/), ['main.ts']);
    assert.deepEqual(quem(/console\./), []);
  });

  it('o gateway nao expoe NADA: nem servidor HTTP, nem rota, nem porta', () => {
    assert.deepEqual(quem(/\.listen\(|createServer\(|express|fastify/), []);
  });

  it('nao ha envio proativo: sendText so e chamado pelo nucleo, apenas com o chat guardado da mensagem', () => {
    assert.deepEqual(quem(/\.sendText\(/), ['gateway.ts']);
    const gateway = semComentarios(FONTES.find((f) => f.arquivo === 'gateway.ts')?.codigo ?? '');
    assert.equal(gateway.match(/\.sendText\(/g)?.length, 1);
    assert.match(gateway, /await this\.send\(socket, message\.chatJid, response\.reply\)/);
  });

  it('o destino da resposta nunca e montado a partir de campos do backend', () => {
    const gateway = semComentarios(FONTES.find((f) => f.arquivo === 'gateway.ts')?.codigo ?? '');

    assert.doesNotMatch(gateway, /@s\.whatsapp\.net|@lid|jidEncode|response\.replyTo\s*\+/);
  });

  it('LID nunca vira telefone: a identidade do filtro vem so de resolveSenderPhone e nao existe tipo "lid" de remetente', () => {
    const filtro = semComentarios(
      FONTES.find((f) => f.arquivo === 'message-filter.ts')?.codigo ?? '',
    );

    assert.match(filtro, /from: sender\.phone/);
    assert.doesNotMatch(filtro, /idKind|SenderIdKind|from: chat\.user|from: user/);
    assert.match(filtro, /export type PhoneSource = 'chat-pn' \| 'lid-com-telefone'/);
  });

  it('QR Code: nada o le, o imprime ou o registra', () => {
    assert.deepEqual(quem(/\bqr\b|qrcode|printQRInTerminal/i), []);
  });

  it('useMultiFileAuthState nao e usado (a sessao tera armazenamento proprio, cifrado)', () => {
    assert.deepEqual(quem(/useMultiFileAuthState/), []);
  });

  it('o token de servico so e lido por config.ts e usado so pelo cliente HTTP', () => {
    assert.deepEqual(quem(/serviceToken/), ['config.ts', 'main.ts']);
    assert.deepEqual(quem(/x-service-token/i), ['ingest-client.ts']);
  });

  it('nao ha segredo, JID ou numero fixos no codigo', () => {
    assert.deepEqual(quem(/vfs_[A-Za-z0-9_-]{20,}|\d{10,}@/), []);
  });

  it('nao ha dependencia do backend NestJS, do Plantae, do n8n nem de outro canal', () => {
    for (const { codigo } of FONTES) {
      assert.deepEqual(
        importsDe(codigo).filter((o) => /backend|nestjs|plantae|n8n|telegram/i.test(o)),
        [],
      );
    }
  });
});
