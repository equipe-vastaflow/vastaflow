import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { AuditService } from '../../audit/audit.service';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandsModule } from '../../commands/commands.module';
import { NfseEmission } from './nfse-emission.entity';
import { NfseEmissionsRepository } from './nfse-emissions.repository';
import {
  NfseConfirmCommandHandler,
  NfseRequestCommandHandler,
  NfseStatusCommandHandler,
} from './nfse.commands';
import { NfseService } from './nfse.service';

/**
 * NFS-e Nacional (Emissor Publico Nacional). DESLIGADA por padrao (`NFSE_ENABLED=false`).
 *
 * Isolado: depende so do motor de comandos e da auditoria, e NAO conhece canal nenhum. Os comandos
 * `/nfse`, `/nfse_confirmar` e `/nfse_status` entram no Command Engine existente e chegam por
 * Telegram e WhatsApp pela MESMA cadeia (identidade -> RBAC -> motor -> auditoria). Nao ha rota HTTP:
 * emitir nota nao e uma API aberta.
 *
 * Permissoes proprias (`nfse:emit`, `nfse:read`), de ninguem por padrao alem do ADMIN. Nao depende da
 * API do Plantae. Ver `docs/nfse.md`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([NfseEmission]), AuditModule, CommandsModule],
  providers: [
    NfseEmissionsRepository,
    {
      provide: NfseService,
      inject: [ConfigService, NfseEmissionsRepository, AuditService],
      useFactory: (
        config: ConfigService,
        repository: NfseEmissionsRepository,
        audit: AuditService,
      ): NfseService => new NfseService(config, repository, audit),
    },
    {
      provide: NfseRequestCommandHandler,
      inject: [NfseService],
      useFactory: (service: NfseService): NfseRequestCommandHandler =>
        new NfseRequestCommandHandler(service),
    },
    {
      provide: NfseConfirmCommandHandler,
      inject: [NfseService],
      useFactory: (service: NfseService): NfseConfirmCommandHandler =>
        new NfseConfirmCommandHandler(service),
    },
    {
      provide: NfseStatusCommandHandler,
      inject: [NfseService],
      useFactory: (service: NfseService): NfseStatusCommandHandler =>
        new NfseStatusCommandHandler(service),
    },
  ],
})
export class NfseModule implements OnModuleInit {
  constructor(
    private readonly catalog: CommandCatalog,
    private readonly request: NfseRequestCommandHandler,
    private readonly confirm: NfseConfirmCommandHandler,
    private readonly status: NfseStatusCommandHandler,
  ) {}

  /** Registrar nao liga nada: com `NFSE_ENABLED=false` cada comando responde "desligado". */
  onModuleInit(): void {
    this.catalog.register([this.request, this.confirm, this.status]);
  }
}
