import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FinanceModule } from '../finance/finance.module';
import { CommandCatalog } from './command-catalog';
import { CommandRouter } from './command-router.service';
import { CommandsController } from './commands.controller';
import { FinanceCommandHandler } from './handlers/finance.command';
import { HelpCommandHandler } from './handlers/help.command';
import { StatusCommandHandler } from './handlers/status.command';
import { NonProductionGuard } from './non-production.guard';

/**
 * Motor de comandos: nucleo reutilizavel que interpreta mensagens de texto e as
 * encaminha para o handler correspondente.
 *
 * Sem entity, sem repositorio e sem tabela propria - por isso nenhuma migration
 * foi necessaria. Nao depende de canal nenhum: Telegram e WhatsApp entrarao
 * como modulos-adaptadores que importam este e chamam o `CommandRouter`.
 *
 * Para acrescentar um comando: criar o handler, declara-lo em `providers` e
 * inclui-lo na lista do `onModuleInit`. Um comando que exija autorizacao
 * declara `permission`, e um que precise entrar na trilha de auditoria declara
 * `audit` - o router cuida dos dois.
 *
 * Importa `AuditModule` para reusar o `AuditService`: a gravacao da trilha e a
 * higienizacao dos metadados continuam sendo as do modulo de auditoria.
 */
@Module({
  imports: [AuditModule, FinanceModule],
  controllers: [CommandsController],
  providers: [
    CommandCatalog,
    CommandRouter,
    HelpCommandHandler,
    StatusCommandHandler,
    FinanceCommandHandler,
    NonProductionGuard,
  ],
  // O catalogo e exportado para que um modulo de dominio/integracao registre o SEU
  // comando (ex.: `/contas_pagar`, do Plantae) sem este modulo importa-lo.
  exports: [CommandRouter, CommandCatalog],
})
export class CommandsModule implements OnModuleInit {
  constructor(
    private readonly catalog: CommandCatalog,
    private readonly help: HelpCommandHandler,
    private readonly status: StatusCommandHandler,
    private readonly finance: FinanceCommandHandler,
  ) {}

  /**
   * Registra os handlers no catalogo. O modulo faz esse papel - e nao uma
   * injecao da lista no proprio catalogo - porque `/ajuda` depende do catalogo
   * para se listar, e a injecao inversa criaria um ciclo. Ver `CommandCatalog`.
   */
  onModuleInit(): void {
    this.catalog.register([this.help, this.status, this.finance]);
  }
}
