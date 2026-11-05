import { NotFoundException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { SERVICE_ROUTE_KEY, SERVICE_SCOPES_KEY } from '../../service-auth/service-auth.constants';
import {
  type AuthenticatedService,
  SERVICE_PRINCIPALS,
  ServicePrincipalId,
  ServiceScope,
} from '../../service-auth/service-principals';
import { WhatsappIngestController } from './whatsapp-ingest.controller';
import { WhatsappIngestDto } from './whatsapp-ingest.dto';
import type { WhatsappMessageProcessor, WhatsappResult } from './whatsapp-message.processor';

const SERVICE: AuthenticatedService = {
  principal: ServicePrincipalId.WhatsappGateway,
  credentialId: 'gw-1',
  scopes: [ServiceScope.WhatsappIngest],
};

const BODY: WhatsappIngestDto = {
  version: 1,
  messageId: '3EB0ABC123',
  from: '5511999990001',
  to: '5511900000000',
  chatType: 'private',
  text: '/ajuda',
  timestamp: 1_790_000_000,
};

function montar(
  config: Record<string, unknown>,
  result: WhatsappResult = { outcome: 'EXECUTED', reply: 'Comandos', correlationId: 'evt-1' },
): { controller: WhatsappIngestController; process: jest.Mock } {
  const process = jest.fn(() => Promise.resolve(result));
  const controller = new WhatsappIngestController(new ConfigService(config), {
    process,
  } as unknown as WhatsappMessageProcessor);
  return { controller, process };
}

const GATEWAY_LIGADO = { WHATSAPP_ENABLED: true, WHATSAPP_TRANSPORT: 'gateway' };

describe('WhatsappIngestController - desligado por padrao', () => {
  it.each([
    ['sem nenhuma configuracao', {}],
    ['WHATSAPP_ENABLED=false', { WHATSAPP_ENABLED: false, WHATSAPP_TRANSPORT: 'gateway' }],
    ['ligado mas transporte meta (padrao)', { WHATSAPP_ENABLED: true }],
    ['ligado e transporte meta explicito', { WHATSAPP_ENABLED: true, WHATSAPP_TRANSPORT: 'meta' }],
    ['transporte desconhecido', { WHATSAPP_ENABLED: true, WHATSAPP_TRANSPORT: 'outro' }],
    ['ENABLED como texto "true"', { WHATSAPP_ENABLED: 'true', WHATSAPP_TRANSPORT: 'gateway' }],
  ])('%s: 404 e nada e processado', async (_nome, config) => {
    const { controller, process } = montar(config);

    await expect(controller.ingest(BODY, SERVICE)).rejects.toBeInstanceOf(NotFoundException);
    expect(process).not.toHaveBeenCalled();
  });
});

describe('WhatsappIngestController - gateway ativo', () => {
  it('entrega ao processador so os campos da mensagem e o contexto do SERVICO autenticado', async () => {
    const { controller, process } = montar(GATEWAY_LIGADO);

    await controller.ingest(BODY, SERVICE);

    expect(process).toHaveBeenCalledWith(
      {
        phoneNumberId: BODY.to,
        messageId: BODY.messageId,
        from: BODY.from,
        text: BODY.text,
        timestamp: BODY.timestamp,
      },
      { origem: 'gateway-baileys', principal: 'whatsapp-gateway', servicoId: 'gw-1' },
    );
  });

  it('responde com o texto e o destino SEMPRE igual ao remetente da mensagem', async () => {
    const { controller } = montar(GATEWAY_LIGADO);

    expect(await controller.ingest(BODY, SERVICE)).toEqual({
      correlationId: 'evt-1',
      outcome: 'EXECUTED',
      duplicate: false,
      replyTo: BODY.from,
      reply: 'Comandos',
    });
  });

  it.each([
    ['DUPLICATE', true],
    ['UNLINKED', false],
    ['STALE', false],
    ['IGNORED', false],
    ['RATE_LIMITED', false],
    ['FAILED', false],
  ] as const)('%s sem resposta: `replyTo` e `reply` nulos, duplicate=%s', async (outcome, dup) => {
    const { controller } = montar(GATEWAY_LIGADO, { outcome, reply: null, correlationId: null });

    expect(await controller.ingest(BODY, SERVICE)).toEqual({
      correlationId: null,
      outcome,
      duplicate: dup,
      replyTo: null,
      reply: null,
    });
  });

  it('o destino nao depende de nenhum outro campo: outro `to` nao muda o `replyTo`', async () => {
    const { controller } = montar(GATEWAY_LIGADO);

    const r = await controller.ingest({ ...BODY, to: '5511933334444' }, SERVICE);

    expect(r.replyTo).toBe(BODY.from);
  });
});

describe('WhatsappIngestDto - contrato estrito (as opcoes do ValidationPipe global)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
  const validar = (corpo: unknown): Promise<unknown> =>
    pipe.transform(corpo, { type: 'body', metatype: WhatsappIngestDto });

  it('aceita a mensagem valida', async () => {
    await expect(validar({ ...BODY })).resolves.toMatchObject({ from: BODY.from });
  });

  it.each([
    ['campo a mais (replyTo)', { replyTo: '5511999990002' }],
    ['campo a mais (actorUserId)', { actorUserId: 'x' }],
    ['campo a mais (role)', { role: 'ADMIN' }],
    ['campo a mais (permissions)', { permissions: ['*'] }],
    ['versao 2', { version: 2 }],
    ['grupo', { chatType: 'group' }],
    ['from com JID', { from: '5511999990001@s.whatsapp.net' }],
    ['from curto', { from: '1234' }],
    ['from com 21 digitos', { from: '1'.repeat(21) }],
    ['to invalido', { to: 'bot' }],
    ['messageId com espaco', { messageId: 'a b' }],
    ['messageId com 201 caracteres', { messageId: 'A'.repeat(201) }],
    ['texto vazio', { text: '' }],
    ['texto com 4097 caracteres', { text: 'x'.repeat(4097) }],
    ['texto objeto', { text: { body: 'x' } }],
    ['timestamp texto', { timestamp: '1790000000' }],
    ['timestamp fracionario', { timestamp: 1.5 }],
    ['timestamp negativo', { timestamp: -1 }],
    ['timestamp acima do seguro', { timestamp: Number.MAX_SAFE_INTEGER + 2 }],
  ])('rejeita: %s', async (_nome, over) => {
    await expect(validar({ ...BODY, ...over })).rejects.toBeDefined();
  });

  it.each(['version', 'messageId', 'from', 'to', 'chatType', 'text', 'timestamp'])(
    'rejeita sem o campo %s',
    async (campo) => {
      const { [campo]: _removido, ...resto } = BODY as unknown as Record<string, unknown>;

      await expect(validar(resto)).rejects.toBeDefined();
    },
  );

  it('aceita texto de exatamente 4096 caracteres e messageId de 200', async () => {
    await expect(
      validar({ ...BODY, text: 'x'.repeat(4096), messageId: 'A'.repeat(200) }),
    ).resolves.toBeDefined();
  });
});

describe('WhatsappIngestController - rota de servico', () => {
  const handler = Reflect.get(WhatsappIngestController.prototype, 'ingest') as object;

  it('tem exatamente UMA rota: POST /service/whatsapp/ingest', () => {
    const metodos = Object.getOwnPropertyNames(WhatsappIngestController.prototype).filter(
      (nome) => nome !== 'constructor',
    );

    expect(metodos).toEqual(['ingest']);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('ingest');
    expect(Reflect.getMetadata(PATH_METADATA, WhatsappIngestController)).toBe('service/whatsapp');
  });

  it('exige o escopo proprio e nunca e publica', () => {
    expect(Reflect.getMetadata(SERVICE_ROUTE_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(SERVICE_SCOPES_KEY, handler)).toEqual([ServiceScope.WhatsappIngest]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WhatsappIngestController)).toBeUndefined();
  });

  it('o escopo e SO do principal whatsapp-gateway, e ele nao tem nenhum outro', () => {
    expect(SERVICE_PRINCIPALS[ServicePrincipalId.WhatsappGateway].scopes).toEqual([
      ServiceScope.WhatsappIngest,
    ]);
    for (const [id, definicao] of Object.entries(SERVICE_PRINCIPALS)) {
      if (id !== (ServicePrincipalId.WhatsappGateway as string)) {
        expect(definicao.scopes).not.toContain(ServiceScope.WhatsappIngest);
      }
    }
  });
});
