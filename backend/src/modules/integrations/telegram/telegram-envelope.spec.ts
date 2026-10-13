import {
  ENVELOPE_MAX_AGE_MS,
  ENVELOPE_MAX_FUTURE_MS,
  isEnvelopeFresh,
  isMessageRecent,
  MESSAGE_MAX_AGE_MS,
  signEnvelope,
  signReply,
  verifyEnvelope,
  verifyReply,
  type TelegramEnvelope,
} from './telegram-envelope';

const KEY = 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres-0123';
const OUTRA_CHAVE = 'outra-chave-de-teste-com-mais-de-trinta-e-dois-caracteres';

const ENVELOPE: TelegramEnvelope = {
  version: 'v1',
  platform: 'telegram',
  botId: '123456789',
  updateId: 1001,
  messageId: 55,
  chatId: '777000111',
  userId: '777000111',
  chatType: 'private',
  text: '/contas_pagar',
  sentAt: 1_790_000_000,
  issuedAt: 1_790_000_005_000,
};

describe('signEnvelope / verifyEnvelope', () => {
  it('a assinatura confere para o mesmo envelope e a mesma chave', () => {
    expect(verifyEnvelope(ENVELOPE, signEnvelope(ENVELOPE, KEY), KEY)).toBe(true);
  });

  it('e deterministica (mesmo envelope, mesma assinatura) e tem 64 hex', () => {
    const a = signEnvelope(ENVELOPE, KEY);

    expect(a).toBe(signEnvelope({ ...ENVELOPE }, KEY));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('outra chave nao confere (o n8n, sem a chave, nao assina nada)', () => {
    expect(verifyEnvelope(ENVELOPE, signEnvelope(ENVELOPE, OUTRA_CHAVE), KEY)).toBe(false);
  });

  describe('QUALQUER campo adulterado derruba a assinatura', () => {
    const adulteracoes: Array<[string, Partial<TelegramEnvelope>]> = [
      ['botId', { botId: '123456780' }],
      ['updateId', { updateId: 1002 }],
      ['messageId', { messageId: 56 }],
      ['chatId (redirecionar a resposta)', { chatId: '999' }],
      ['userId (se passar por outra pessoa)', { userId: '999' }],
      ['texto (trocar o comando)', { text: '/ajuda' }],
      ['texto com um espaco a mais', { text: '/contas_pagar ' }],
      ['sentAt', { sentAt: 1_790_000_001 }],
      ['issuedAt (renovar a validade)', { issuedAt: 1_790_000_999_000 }],
    ];

    it.each(adulteracoes)('%s', (_nome, mudanca) => {
      const assinatura = signEnvelope(ENVELOPE, KEY);

      expect(verifyEnvelope({ ...ENVELOPE, ...mudanca }, assinatura, KEY)).toBe(false);
    });
  });

  it('o texto entra na assinatura por HASH: texto grande nao quebra nem colide por separador', () => {
    const grande = { ...ENVELOPE, text: 'x'.repeat(4096) };
    const comQuebra = { ...ENVELOPE, text: 'a\nb\nc' };

    expect(verifyEnvelope(grande, signEnvelope(grande, KEY), KEY)).toBe(true);
    expect(signEnvelope(comQuebra, KEY)).not.toBe(
      signEnvelope({ ...comQuebra, text: 'a b c' }, KEY),
    );
  });

  it.each([
    ['vazia', ''],
    ['curta', 'abcd'],
    ['sem ser hex', 'z'.repeat(64)],
    ['maiuscula (formato diferente)', signEnvelope(ENVELOPE, KEY).toUpperCase().slice(0, 63) + 'Z'],
    ['longa demais', 'a'.repeat(128)],
  ])('assinatura %s e recusada sem lancar', (_nome, assinatura) => {
    expect(verifyEnvelope(ENVELOPE, assinatura, KEY)).toBe(false);
  });

  it('a chave nunca aparece na assinatura nem no envelope', () => {
    expect(signEnvelope(ENVELOPE, KEY)).not.toContain(KEY);
    expect(JSON.stringify(ENVELOPE)).not.toContain(KEY);
  });

  it('usa comparacao em tempo constante (nao `===` sobre a assinatura)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(__dirname, 'telegram-envelope.ts'), 'utf8');

    expect(fonte).toContain('timingSafeEqual(');
  });
});

describe('isEnvelopeFresh', () => {
  const agora = ENVELOPE.issuedAt;

  it('recem-emitido: valido', () => {
    expect(isEnvelopeFresh(ENVELOPE, agora)).toBe(true);
  });

  it('no limite de idade: valido; um milissegundo depois: expirado', () => {
    expect(isEnvelopeFresh(ENVELOPE, agora + ENVELOPE_MAX_AGE_MS)).toBe(true);
    expect(isEnvelopeFresh(ENVELOPE, agora + ENVELOPE_MAX_AGE_MS + 1)).toBe(false);
  });

  it('relogio levemente adiantado do transporte: tolerado ate o limite', () => {
    expect(isEnvelopeFresh(ENVELOPE, agora - ENVELOPE_MAX_FUTURE_MS)).toBe(true);
    expect(isEnvelopeFresh(ENVELOPE, agora - ENVELOPE_MAX_FUTURE_MS - 1)).toBe(false);
  });

  it('a janela e curta (5 minutos)', () => {
    expect(ENVELOPE_MAX_AGE_MS).toBe(5 * 60 * 1000);
  });
});

describe('signReply / verifyReply', () => {
  const resposta = (): { outcome: string; reply: string; signature: string } => {
    const outcome = 'EXECUTED';
    const reply = 'Comandos disponiveis:\n/ajuda - Lista os comandos';
    return { outcome, reply, signature: signReply(ENVELOPE, outcome, reply, KEY) };
  };

  it('confere para a resposta original', () => {
    expect(verifyReply(ENVELOPE, resposta(), KEY)).toBe(true);
  });

  it('texto alterado pelo n8n: recusada', () => {
    expect(
      verifyReply(ENVELOPE, { ...resposta(), reply: 'Clique aqui: http://evil.example' }, KEY),
    ).toBe(false);
  });

  it('desfecho alterado: recusada', () => {
    expect(verifyReply(ENVELOPE, { ...resposta(), outcome: 'DENIED' }, KEY)).toBe(false);
  });

  it('e AMARRADA ao envelope: serve so para aquele bot, update e chat', () => {
    const r = resposta();

    expect(verifyReply({ ...ENVELOPE, updateId: 1002 }, r, KEY)).toBe(false);
    expect(verifyReply({ ...ENVELOPE, chatId: '999', userId: '999' }, r, KEY)).toBe(false);
    expect(verifyReply({ ...ENVELOPE, botId: '5' }, r, KEY)).toBe(false);
  });

  it('chave diferente: recusada', () => {
    expect(
      verifyReply(
        ENVELOPE,
        { ...resposta(), signature: signReply(ENVELOPE, 'EXECUTED', 'x', OUTRA_CHAVE) },
        KEY,
      ),
    ).toBe(false);
  });

  it('assinatura de ENVELOPE nao vale como assinatura de RESPOSTA (dominios separados)', () => {
    const r = resposta();

    expect(verifyReply(ENVELOPE, { ...r, signature: signEnvelope(ENVELOPE, KEY) }, KEY)).toBe(
      false,
    );
  });

  it('assinatura malformada: recusada sem lancar', () => {
    expect(verifyReply(ENVELOPE, { ...resposta(), signature: 'xyz' }, KEY)).toBe(false);
  });
});

describe('assinatura estrita (Fase 5.1)', () => {
  it('uma assinatura valida SEGUIDA DE LIXO nao confere (Buffer.from(hex) truncaria)', () => {
    const boa = signEnvelope(ENVELOPE, KEY);

    expect(verifyEnvelope(ENVELOPE, boa, KEY)).toBe(true);
    expect(verifyEnvelope(ENVELOPE, `${boa}zz`, KEY)).toBe(false);
    expect(verifyEnvelope(ENVELOPE, `${boa}00`, KEY)).toBe(false);
    expect(verifyEnvelope(ENVELOPE, ` ${boa}`, KEY)).toBe(false);
    expect(verifyEnvelope(ENVELOPE, `${boa}\n`, KEY)).toBe(false);
  });

  it('o mesmo vale para a assinatura da resposta', () => {
    const reply = { outcome: 'EXECUTED', reply: 'ok' };
    const boa = signReply(ENVELOPE, reply.outcome, reply.reply, KEY);

    expect(verifyReply(ENVELOPE, { ...reply, signature: boa }, KEY)).toBe(true);
    expect(verifyReply(ENVELOPE, { ...reply, signature: `${boa}zz` }, KEY)).toBe(false);
    expect(verifyReply(ENVELOPE, { ...reply, signature: boa.toUpperCase() }, KEY)).toBe(false);
  });

  it('cada campo assinado muda a assinatura (nenhum fica de fora)', () => {
    const base = signEnvelope(ENVELOPE, KEY);
    const variantes: Array<Partial<TelegramEnvelope>> = [
      { botId: '1' },
      { updateId: 2 },
      { messageId: 3 },
      { chatId: '4' },
      { userId: '5' },
      { sentAt: 6 },
      { issuedAt: 7 },
      { text: 'outro' },
    ];

    for (const v of variantes) {
      expect(signEnvelope({ ...ENVELOPE, ...v }, KEY)).not.toBe(base);
    }
  });

  it('o texto nao consegue forjar outro campo por separador (so entra o hash)', () => {
    const a = { ...ENVELOPE, text: 'x\n123' };
    const b = { ...ENVELOPE, text: 'x', issuedAt: 123 };

    expect(signEnvelope(a, KEY)).not.toBe(signEnvelope(b, KEY));
  });
});

describe('isMessageRecent', () => {
  const now = ENVELOPE.sentAt * 1000;

  it('mensagem recente executa; no limite ainda; depois do limite nao', () => {
    expect(isMessageRecent(ENVELOPE, now)).toBe(true);
    expect(isMessageRecent(ENVELOPE, now + MESSAGE_MAX_AGE_MS)).toBe(true);
    expect(isMessageRecent(ENVELOPE, now + MESSAGE_MAX_AGE_MS + 1)).toBe(false);
  });

  it('mensagem "do futuro" alem da tolerancia de relogio nao executa', () => {
    expect(isMessageRecent(ENVELOPE, now - ENVELOPE_MAX_FUTURE_MS)).toBe(true);
    expect(isMessageRecent(ENVELOPE, now - ENVELOPE_MAX_FUTURE_MS - 1)).toBe(false);
  });

  it('o prazo da mensagem e independente do envelope (um envelope novo nao ressuscita mensagem velha)', () => {
    const velha = { ...ENVELOPE, issuedAt: now + 3 * 60 * 60 * 1000 };

    expect(isEnvelopeFresh(velha, velha.issuedAt)).toBe(true);
    expect(isMessageRecent(velha, velha.issuedAt)).toBe(false);
  });

  it('a janela da mensagem e de 10 minutos', () => {
    expect(MESSAGE_MAX_AGE_MS).toBe(10 * 60 * 1000);
  });
});
