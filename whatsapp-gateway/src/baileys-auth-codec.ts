import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { AuthCodec } from './encrypted-session-store.js';

/**
 * Codec REAL do estado de autenticacao do Baileys (junto de `baileys-socket.ts`, os unicos que importam a biblioteca).
 *
 * - `BufferJSON` e o que o proprio Baileys usa para serializar `Buffer`/`Uint8Array` em JSON (chaves, segredos);
 * - `app-state-sync-key` volta como mensagem protobuf (o Baileys espera esse tipo, nao um objeto cru);
 * - nada aqui grava em disco nem registra nada: o texto serializado so existe em memoria ate ser cifrado.
 */
export const baileysAuthCodec: AuthCodec = {
  newCreds: () => initAuthCreds(),
  serialize: (value) => JSON.stringify(value, BufferJSON.replacer),
  deserialize: (text) => JSON.parse(text, BufferJSON.reviver) as unknown,
  reviveKey: (type, value) =>
    type === 'app-state-sync-key' && typeof value === 'object' && value !== null
      ? proto.Message.AppStateSyncKeyData.create(value)
      : value,
};
