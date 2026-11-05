import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMessage, parseJid, toSeconds } from './message-filter.js';
import type { RawWaMessage } from './ports.js';
import { SENDER, T0_MS, textMessage } from './testing/fakes.js';

const NOW = Math.floor(T0_MS / 1000);

const reason = (raw: RawWaMessage): string | null => {
  const r = classifyMessage(raw, NOW);
  return r.accepted ? null : r.reason;
};

describe('classifyMessage - aceita', () => {
  it('texto simples de conversa individual, de outra pessoa, recente', () => {
    const r = classifyMessage(textMessage({ text: '/ajuda', id: 'ABC123' }), NOW);

    assert.equal(r.accepted, true);
    if (r.accepted) {
      assert.deepEqual(r.message, {
        messageId: 'ABC123',
        from: SENDER,
        phoneSource: 'chat-pn',
        chatJid: `${SENDER}@s.whatsapp.net`,
        text: '/ajuda',
        timestamp: NOW,
      });
    }
  });

  it('texto estendido (resposta/link) e mensagem temporaria embrulhada', () => {
    const estendida = textMessage({ message: { extendedTextMessage: { text: '/status' } } });
    const temporaria = textMessage({
      message: { ephemeralMessage: { message: { conversation: '/status' } } },
    });

    for (const raw of [estendida, temporaria]) {
      const r = classifyMessage(raw, NOW);
      assert.equal(r.accepted && r.message.text, '/status');
    }
  });

  it('timestamp como texto, bigint ou Long', () => {
    for (const ts of [String(NOW), BigInt(NOW), { toNumber: () => NOW }]) {
      assert.equal(classifyMessage(textMessage({ messageTimestamp: ts }), NOW).accepted, true);
    }
  });

  it('limites do texto: 1 e 4096 caracteres', () => {
    assert.equal(classifyMessage(textMessage({ text: 'x' }), NOW).accepted, true);
    assert.equal(classifyMessage(textMessage({ text: 'x'.repeat(4096) }), NOW).accepted, true);
  });

  it('idade no limite: 10 min passa, 10 min + 1 s nao; 5 min no futuro passa', () => {
    assert.equal(classifyMessage(textMessage({ messageTimestamp: NOW - 600 }), NOW).accepted, true);
    assert.equal(reason(textMessage({ messageTimestamp: NOW - 601 })), 'antiga');
    assert.equal(classifyMessage(textMessage({ messageTimestamp: NOW + 300 }), NOW).accepted, true);
  });
});

describe('classifyMessage - identidade do remetente (telefone verificado; LID nunca vira telefone)', () => {
  /** Telefone da "vitima": um usuario REAL ja vinculado no backend, cujo numero o atacante tenta assumir. */
  const VITIMA = '5511988887777';
  const LID_DO_ATACANTE = '123456789012345';
  const pn = (numero: string): string => `${numero}@s.whatsapp.net`;
  const chatLid = (
    over: Partial<NonNullable<RawWaMessage['key']>> = {},
    lid = LID_DO_ATACANTE,
  ): RawWaMessage =>
    textMessage({ key: { id: 'L1', remoteJid: `${lid}@lid`, fromMe: false, ...over } });
  const chatPn = (
    over: Partial<NonNullable<RawWaMessage['key']>> = {},
    numero = SENDER,
  ): RawWaMessage =>
    textMessage({ key: { id: 'P1', remoteJid: pn(numero), fromMe: false, ...over } });

  describe('PN valido', () => {
    it('chat de telefone: o telefone e o do chat (chat-pn)', () => {
      const r = classifyMessage(chatPn(), NOW);

      assert.equal(r.accepted, true);
      if (r.accepted) {
        assert.equal(r.message.from, SENDER);
        assert.equal(r.message.phoneSource, 'chat-pn');
        assert.equal(r.message.chatJid, pn(SENDER));
      }
    });

    it('com sufixo de dispositivo no JID', () => {
      const r = classifyMessage(chatPn({ remoteJid: `${SENDER}:7@s.whatsapp.net` }), NOW);

      assert.equal(r.accepted && r.message.from, SENDER);
    });

    it('alternativa LID de um chat de telefone e aceita e ignorada (a identidade segue sendo o telefone)', () => {
      const r = classifyMessage(chatPn({ remoteJidAlt: `${LID_DO_ATACANTE}@lid` }), NOW);

      assert.equal(r.accepted && r.message.from, SENDER);
    });

    it('alternativa de telefone IGUAL ao do chat nao e contradicao', () => {
      assert.equal(classifyMessage(chatPn({ remoteJidAlt: pn(SENDER) }), NOW).accepted, true);
    });

    it('formato E.164: 8 a 15 digitos, sem zero a esquerda', () => {
      for (const ok of ['12345678', '123456789012345']) {
        assert.equal(classifyMessage(chatPn({}, ok), NOW).accepted, true, ok);
      }
      for (const ruim of ['1234567', '1234567890123456', '0123456789', '12345abc']) {
        assert.equal(reason(chatPn({}, ruim)), 'remetente-invalido', ruim);
      }
    });
  });

  describe('LID com telefone confiavel (remoteJidAlt = JID de telefone valido)', () => {
    it('usa o TELEFONE do remoteJidAlt como identidade; o LID so identifica o chat de resposta', () => {
      const r = classifyMessage(chatLid({ remoteJidAlt: pn(SENDER) }), NOW);

      assert.equal(r.accepted, true);
      if (r.accepted) {
        assert.equal(r.message.from, SENDER);
        assert.equal(r.message.phoneSource, 'lid-com-telefone');
        assert.equal(r.message.chatJid, `${LID_DO_ATACANTE}@lid`);
      }
    });

    it('os digitos do LID NUNCA aparecem como identidade, mesmo com telefone associado', () => {
      const r = classifyMessage(chatLid({ remoteJidAlt: pn(SENDER) }), NOW);

      assert.ok(r.accepted);
      assert.notEqual(r.message.from, LID_DO_ATACANTE);
    });

    it('com sufixo de dispositivo no remoteJidAlt', () => {
      const r = classifyMessage(chatLid({ remoteJidAlt: `${SENDER}:3@s.whatsapp.net` }), NOW);

      assert.equal(r.accepted && r.message.from, SENDER);
    });
  });

  describe('LID SEM telefone: descartado, sem chamar o backend', () => {
    it('sem remoteJidAlt: lid-sem-telefone', () => {
      assert.equal(reason(chatLid()), 'lid-sem-telefone');
    });

    for (const [nome, alt] of [
      ['null', null],
      ['undefined', undefined],
      ['vazio', ''],
    ] as const) {
      it(`remoteJidAlt ${nome}: lid-sem-telefone`, () => {
        assert.equal(reason(chatLid({ remoteJidAlt: alt })), 'lid-sem-telefone');
      });
    }

    it('remoteJidAlt que e OUTRO LID (nao e telefone): lid-sem-telefone', () => {
      assert.equal(reason(chatLid({ remoteJidAlt: '999888777666555@lid' })), 'lid-sem-telefone');
    });
  });

  describe('LID numericamente igual ao telefone de outro usuario NUNCA assume a identidade dele', () => {
    it('LID = telefone da vitima, sem telefone associado: descartado (nada chega ao backend)', () => {
      assert.equal(reason(chatLid({}, VITIMA)), 'lid-sem-telefone');
    });

    it('LID = telefone da vitima, com o telefone REAL do atacante: a identidade e a do atacante, nunca a da vitima', () => {
      const r = classifyMessage(chatLid({ remoteJidAlt: pn(SENDER) }, VITIMA), NOW);

      assert.ok(r.accepted);
      assert.equal(r.message.from, SENDER);
      assert.notEqual(r.message.from, VITIMA);
    });

    it('LID = telefone da vitima, com alternativa que e OUTRO LID: descartado', () => {
      assert.equal(reason(chatLid({ remoteJidAlt: `${VITIMA}@lid` }, VITIMA)), 'lid-sem-telefone');
    });

    it('LID = telefone da vitima, com alternativa malformada que "parece" a vitima: descartado', () => {
      for (const alt of [`${VITIMA}@lid.fake`, `${VITIMA}`, `${VITIMA}@`, `@${VITIMA}`]) {
        assert.notEqual(reason(chatLid({ remoteJidAlt: alt }, VITIMA)), null, alt);
        const r = classifyMessage(chatLid({ remoteJidAlt: alt }, VITIMA), NOW);
        assert.equal(r.accepted, false, alt);
      }
    });

    it('nenhuma combinacao de LID numerico produz from igual a um LID', () => {
      const casos: RawWaMessage[] = [
        chatLid({}, VITIMA),
        chatLid({ remoteJidAlt: `${VITIMA}@lid` }, VITIMA),
        chatLid({ remoteJidAlt: null }, VITIMA),
        chatLid({ remoteJidAlt: pn(SENDER) }, VITIMA),
      ];
      for (const raw of casos) {
        const r = classifyMessage(raw, NOW);
        if (r.accepted) {
          assert.notEqual(r.message.from, VITIMA);
          assert.equal(r.message.phoneSource, 'lid-com-telefone');
        }
      }
    });
  });

  describe('JIDs malformados e dados contraditorios', () => {
    it('remoteJidAlt malformado ou de tipo invalido: jid-alt-invalido (vale para chat de telefone e de LID)', () => {
      for (const alt of [
        'sem-arroba',
        'abc@s.whatsapp.net',
        '1234@s.whatsapp.net',
        '0123456789@s.whatsapp.net',
        `${SENDER}@g.us`,
        `${SENDER}@broadcast`,
        `${SENDER}@outro.servidor`,
        'abc@lid',
        '@lid',
        'a'.repeat(200) + '@lid',
      ]) {
        assert.equal(reason(chatLid({ remoteJidAlt: alt })), 'jid-alt-invalido', `lid: ${alt}`);
        assert.equal(reason(chatPn({ remoteJidAlt: alt })), 'jid-alt-invalido', `pn: ${alt}`);
      }
    });

    it('remoteJidAlt que nao e texto: jid-alt-invalido ou ignorado, nunca aceito como telefone', () => {
      for (const alt of [5, {}, [], true] as unknown as string[]) {
        const r = classifyMessage(chatLid({ remoteJidAlt: alt }), NOW);
        assert.equal(r.accepted, false);
      }
    });

    it('chat de telefone com OUTRO telefone no remoteJidAlt: identidade-contraditoria', () => {
      assert.equal(reason(chatPn({ remoteJidAlt: pn(VITIMA) })), 'identidade-contraditoria');
    });

    it('conversa individual com participant: identidade-contraditoria (em LID e em telefone)', () => {
      assert.equal(reason(chatPn({ participant: pn(VITIMA) })), 'identidade-contraditoria');
      assert.equal(
        reason(chatLid({ remoteJidAlt: pn(SENDER), participant: pn(VITIMA) })),
        'identidade-contraditoria',
      );
    });

    it('chat LID com usuario nao numerico: remetente-invalido', () => {
      assert.equal(
        reason(textMessage({ key: { id: 'X', remoteJid: 'abc@lid', fromMe: false } })),
        'remetente-invalido',
      );
    });

    it('chat com JID malformado ou de tipo desconhecido: nunca ha identidade', () => {
      for (const jid of ['', 'sem-arroba', '@lid', `${SENDER}@`, `${SENDER}@hosted`]) {
        const r = classifyMessage(
          textMessage({ key: { id: 'X', remoteJid: jid, fromMe: false } }),
          NOW,
        );
        assert.equal(r.accepted, false, jid);
      }
    });

    it('um objeto qualquer no lugar do JID nunca lanca nem aceita', () => {
      for (const jid of [5, {}, [], null, undefined] as unknown as string[]) {
        const r = classifyMessage(
          textMessage({ key: { id: 'X', remoteJid: jid, fromMe: false } }),
          NOW,
        );
        assert.equal(r.accepted, false);
      }
    });
  });
});

describe('classifyMessage - ignora', () => {
  const chat = (remoteJid: string): RawWaMessage =>
    textMessage({ key: { id: 'X', remoteJid, fromMe: false } });

  const casos: [string, RawWaMessage, string][] = [
    [
      'mensagem propria',
      textMessage({ key: { id: 'X', remoteJid: `${SENDER}@s.whatsapp.net`, fromMe: true } }),
      'propria',
    ],
    ['grupo', chat('120363000000000000@g.us'), 'grupo'],
    ['lista de transmissao', chat('1234567890@broadcast'), 'broadcast'],
    ['status', chat('status@broadcast'), 'status'],
    ['newsletter/canal', chat('120363000000000000@newsletter'), 'newsletter'],
    ['servidor desconhecido', chat('5511999990001@outro.servidor'), 'jid-nao-suportado'],
    ['JID malformado', chat('sem-arroba'), 'jid-nao-suportado'],
    ['sem remoteJid', textMessage({ key: { id: 'X', fromMe: false } }), 'jid-nao-suportado'],
    ['sem chave', { message: { conversation: 'x' } }, 'sem-chave'],
    [
      'sem id',
      textMessage({ key: { remoteJid: `${SENDER}@s.whatsapp.net`, fromMe: false } }),
      'sem-id',
    ],
    ['sem conteudo', textMessage({ message: null }), 'sem-conteudo'],
    ['flag de broadcast', textMessage({ broadcast: true }), 'broadcast'],
    ['evento de sistema (stub)', textMessage({ messageStubType: 28 }), 'evento-de-sistema'],
    ['reacao', textMessage({ message: { reactionMessage: { text: '👍' } } }), 'reacao'],
    [
      'edicao',
      textMessage({ message: { editedMessage: { message: { conversation: '/ajuda' } } } }),
      'edicao',
    ],
    [
      'protocolo (apagar/editar)',
      textMessage({ message: { protocolMessage: { type: 0 } } }),
      'protocolo',
    ],
    [
      'reacao dentro de mensagem temporaria',
      textMessage({ message: { ephemeralMessage: { message: { reactionMessage: {} } } } }),
      'reacao',
    ],
    [
      'encaminhada',
      textMessage({
        message: { extendedTextMessage: { text: '/ajuda', contextInfo: { isForwarded: true } } },
      }),
      'encaminhada',
    ],
    ['imagem', textMessage({ message: { imageMessage: { caption: '/ajuda' } } }), 'nao-texto'],
    ['documento', textMessage({ message: { documentMessage: {} } }), 'nao-texto'],
    ['audio', textMessage({ message: { audioMessage: {} } }), 'nao-texto'],
    ['figurinha', textMessage({ message: { stickerMessage: {} } }), 'nao-texto'],
    ['localizacao', textMessage({ message: { locationMessage: {} } }), 'nao-texto'],
    ['enquete', textMessage({ message: { pollCreationMessage: {} } }), 'nao-texto'],
    ['texto vazio', textMessage({ text: '' }), 'texto-invalido'],
    ['texto com 4097 caracteres', textMessage({ text: 'x'.repeat(4097) }), 'texto-invalido'],
    ['sem timestamp', textMessage({ messageTimestamp: undefined }), 'sem-timestamp'],
    ['timestamp invalido', textMessage({ messageTimestamp: -5 }), 'sem-timestamp'],
    ['timestamp fracionario', textMessage({ messageTimestamp: 1.5 }), 'sem-timestamp'],
    ['mensagem antiga', textMessage({ messageTimestamp: NOW - 3600 }), 'antiga'],
    ['mensagem do futuro', textMessage({ messageTimestamp: NOW + 3600 }), 'futura'],
    [
      'remetente nao numerico',
      textMessage({ key: { id: 'X', remoteJid: 'abc@s.whatsapp.net', fromMe: false } }),
      'remetente-invalido',
    ],
  ];

  for (const [nome, raw, motivo] of casos) {
    it(`${nome}: ${motivo}`, () => {
      assert.equal(reason(raw), motivo);
    });
  }

  it('um objeto qualquer nunca lanca', () => {
    for (const lixo of [
      {},
      { key: null },
      { key: {}, message: 5 },
      { key: { id: 5 } },
    ] as RawWaMessage[]) {
      assert.doesNotThrow(() => classifyMessage(lixo, NOW));
    }
  });
});

describe('parseJid e toSeconds', () => {
  it('parseJid', () => {
    assert.deepEqual(parseJid('5511:3@s.whatsapp.net'), { user: '5511', server: 's.whatsapp.net' });
    assert.deepEqual(parseJid('1@lid'), { user: '1', server: 'lid' });
    for (const ruim of [undefined, null, 5, '', '@lid', 'x@', 'sem', 'a'.repeat(200) + '@lid']) {
      assert.equal(parseJid(ruim), null);
    }
  });

  it('toSeconds', () => {
    assert.equal(toSeconds(10), 10);
    assert.equal(toSeconds('10'), 10);
    assert.equal(toSeconds(10n), 10);
    assert.equal(toSeconds({ toNumber: () => 10 }), 10);
    for (const ruim of [
      0,
      -1,
      1.5,
      NaN,
      'abc',
      '',
      null,
      undefined,
      {},
      [],
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      assert.equal(toSeconds(ruim), null);
    }
  });
});
