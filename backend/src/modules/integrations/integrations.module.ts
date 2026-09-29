import { Module } from '@nestjs/common';
import { IntegrationRegistry } from './integration-registry';

/**
 * Foundation da camada de integracoes externas: contrato, estados e registro.
 *
 * NENHUMA integracao real existe ainda, e nenhuma chamada externa e feita.
 * Sem entity, sem tabela, sem migration, sem rota HTTP e sem permissao nova.
 *
 * Nao importa modulo nenhum - nem de negocio, nem o `HealthModule` (so o TIPO
 * `HealthIndicatorResult` e reaproveitado). Assim qualquer modulo pode importar
 * este sem risco de ciclo.
 *
 * Como uma integracao futura entra (ex.: Telegram):
 *
 * 1. `TelegramProvider implements IntegrationProvider`, dentro de um
 *    `TelegramModule` proprio - o unico lugar que conhece o SDK/HTTP do Telegram;
 * 2. o `TelegramModule` importa este modulo e, no `onModuleInit`, chama
 *    `registry.register(provider)`;
 * 3. o modulo de negocio que precisar do Telegram depende de uma interface de
 *    capacidade (ex.: "enviar mensagem"), nao do `TelegramProvider`.
 *
 * O `IntegrationRegistry` e exportado; como os modulos do Nest sao singletons,
 * todo importador enxerga o MESMO registro.
 *
 * As integracoes ainda NAO aparecem no `GET /health`: a decisao de expor o
 * estado delas num endpoint publico fica para quando o primeiro provider real
 * existir. O `HealthModule` ja tem o ponto de extensao (`HEALTH_INDICATORS`).
 */
@Module({
  providers: [IntegrationRegistry],
  exports: [IntegrationRegistry],
})
export class IntegrationsModule {}
