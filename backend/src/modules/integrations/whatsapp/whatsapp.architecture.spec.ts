import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { WhatsappMessageProcessor } from './whatsapp-message.processor';
import { WhatsappController } from './whatsapp.controller';

function fontes(): { arquivo: string; codigo: string }[] {
  return readdirSync(__dirname)
    .filter((a) => a.endsWith('.ts') && !a.endsWith('.spec.ts'))
    .map((arquivo) => ({ arquivo, codigo: readFileSync(join(__dirname, arquivo), 'utf8') }));
}
const semComentarios = (codigo: string): string =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsDe = (codigo: string): string[] =>
  [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem ?? '');

const WHATSAPP = fontes();

describe('Arquitetura do canal WhatsApp', () => {
  it('ha fontes para verificar', () => {
    expect(WHATSAPP.length).toBeGreaterThanOrEqual(8);
  });

  it('SO o cliente da Graph API chama fetch (unico ponto de rede)', () => {
    const comFetch = WHATSAPP.filter(({ codigo }) => /\bfetch\b/.test(semComentarios(codigo))).map(
      ({ arquivo }) => arquivo,
    );

    expect(comFetch).toEqual(['whatsapp-api.client.ts']);
  });

  it('o token de acesso so e lido pelo cliente; o App Secret e o token do webhook, so pelo controller', () => {
    const quem = (chave: string): string[] =>
      WHATSAPP.filter(({ codigo }) =>
        new RegExp(String.raw`\.get(<[^>]*>)?\(\s*'${chave}'`).test(semComentarios(codigo)),
      ).map(({ arquivo }) => arquivo);

    expect(quem('WHATSAPP_ACCESS_TOKEN')).toEqual(['whatsapp-api.client.ts']);
    expect(quem('WHATSAPP_APP_SECRET')).toEqual(['whatsapp.controller.ts']);
    expect(quem('WHATSAPP_WEBHOOK_TOKEN')).toEqual(['whatsapp.controller.ts']);
  });

  it('nenhum fonte le process.env nem usa console', () => {
    for (const { codigo } of WHATSAPP) {
      expect(semComentarios(codigo)).not.toMatch(/process\.env|console\./);
    }
  });

  it('nao depende de modulo de negocio, do Plantae nem do n8n', () => {
    for (const { codigo } of WHATSAPP) {
      expect(
        importsDe(codigo).filter((o) =>
          /(^|\/)(finance|documents|plantae|users|settings|notifications|n8n)(\/|$)/.test(o),
        ),
      ).toEqual([]);
    }
  });

  it('o cliente nao segue redirect e o token nunca entra em URL', () => {
    const cliente = semComentarios(
      WHATSAPP.find(({ arquivo }) => arquivo === 'whatsapp-api.client.ts')?.codigo ?? '',
    );

    expect(cliente).toContain("redirect: 'manual'");
    expect(cliente).not.toMatch(/\$\{token\}[^`]*`\s*,\s*\{/);
    expect(cliente).toContain('`Bearer ${token}`');
  });

  it('a unica rota publica do canal e /webhooks/whatsapp, so GET e POST', () => {
    const controller = semComentarios(
      WHATSAPP.find(({ arquivo }) => arquivo === 'whatsapp.controller.ts')?.codigo ?? '',
    );

    expect(controller).toContain("@Controller('webhooks/whatsapp')");
    expect(controller.match(/@(Get|Post|Put|Patch|Delete)\(/g)).toEqual(['@Get(', '@Post(']);
  });
});

describe('WhatsappController desligado (padrao)', () => {
  const process = jest.fn();
  const processor = { process } as unknown as WhatsappMessageProcessor;
  const controller = (ligado: boolean | undefined): WhatsappController =>
    new WhatsappController(
      new ConfigService(ligado === undefined ? {} : { WHATSAPP_ENABLED: ligado }),
      processor,
    );
  const req = { query: { 'hub.mode': 'subscribe' }, headers: {} } as unknown as Request;

  it.each([undefined, false])(
    'WHATSAPP_ENABLED=%p: as duas rotas respondem 404 e nada e processado',
    async (valor) => {
      expect(() => controller(valor).verify(req)).toThrow(NotFoundException);
      await expect(controller(valor).receive(req, {})).rejects.toBeInstanceOf(NotFoundException);
      expect(process).not.toHaveBeenCalled();
    },
  );

  it('so o booleano true liga (texto "true" nao)', () => {
    expect(() =>
      new WhatsappController(new ConfigService({ WHATSAPP_ENABLED: 'true' }), processor).verify(
        req,
      ),
    ).toThrow(NotFoundException);
  });
});
