import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Liga o WhatsApp no transporte `gateway` (futuro conteiner Baileys) nos e2e. Importar ANTES do `app.module.ts`.
 * Nada aqui e real: numero de conta ficticio, credenciais geradas no teste, nenhuma conexao com o WhatsApp.
 *
 * O arquivo de credenciais de servico e escrito pelo proprio spec (so o CAMINHO precisa existir na validacao).
 */
export const GATEWAY_ACCOUNT = '5511900000000';
export const GATEWAY_CREDENTIALS_DIR = mkdtempSync(join(tmpdir(), 'vf-wa-gateway-e2e-'));
export const GATEWAY_CREDENTIALS_FILE = join(GATEWAY_CREDENTIALS_DIR, 'credentials.json');

process.env.WHATSAPP_ENABLED = 'true';
process.env.WHATSAPP_TRANSPORT = 'gateway';
process.env.WHATSAPP_GATEWAY_ACCOUNT = GATEWAY_ACCOUNT;
process.env.SERVICE_CREDENTIALS_FILE = GATEWAY_CREDENTIALS_FILE;
