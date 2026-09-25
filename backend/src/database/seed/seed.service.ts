import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Permission } from '../../modules/permissions/entities/permission.entity';
import {
  PERMISSION_DESCRIPTIONS,
  PermissionCode,
} from '../../modules/permissions/permission-code.enum';
import { PermissionsService } from '../../modules/permissions/permissions.service';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_DESCRIPTIONS } from '../../modules/roles/role-defaults';
import { RoleName } from '../../modules/roles/role-name.enum';
import { RolesService } from '../../modules/roles/roles.service';
import { SETTING_CATALOG } from '../../modules/settings/setting-catalog';
import { serializeSettingValue } from '../../modules/settings/setting-value';
import { SettingsRepository } from '../../modules/settings/settings.repository';
import { isPasswordValid, PASSWORD_POLICY_MESSAGE } from '../../modules/users/password.policy';
import { UsersService } from '../../modules/users/users.service';

/**
 * Dados iniciais, executados a cada boot e idempotentes: so criam o que falta.
 *
 * 1. Permissoes do catalogo (`PermissionCode`);
 * 2. Perfis (`RoleName`) com as permissoes padrao;
 * 3. Configuracoes do catalogo (`SETTING_CATALOG`), com o valor padrao;
 * 4. Administrador inicial, se `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` estiverem definidos.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly rolesService: RolesService,
    private readonly usersService: UsersService,
    private readonly settingsRepository: SettingsRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedAccessControl();
    await this.seedSettings();
    await this.seedAdmin();
  }

  private async seedAccessControl(): Promise<void> {
    const permissions = await this.seedPermissions();
    await this.seedRoles(permissions);
  }

  /** @returns todas as permissoes do catalogo, indexadas por codigo, e quais acabaram de ser criadas. */
  private async seedPermissions(): Promise<{
    byCode: Map<string, Permission>;
    created: Set<string>;
  }> {
    const byCode = new Map(
      (await this.permissionsService.findAll()).map((permission) => [permission.code, permission]),
    );
    const created = new Set<string>();

    for (const code of Object.values(PermissionCode)) {
      if (!byCode.has(code)) {
        byCode.set(code, await this.permissionsService.create(code, PERMISSION_DESCRIPTIONS[code]));
        created.add(code);
        this.logger.log(`Permissao criada: ${code}`);
      }
    }

    return { byCode, created };
  }

  /**
   * Perfil novo recebe todas as permissoes padrao. Perfil existente recebe
   * apenas as permissoes recem-criadas (ex.: um modulo novo entrou no
   * catalogo), preservando qualquer ajuste feito no banco desde entao.
   */
  private async seedRoles(permissions: {
    byCode: Map<string, Permission>;
    created: Set<string>;
  }): Promise<void> {
    for (const nome of Object.values(RoleName)) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[nome];
      const existing = await this.rolesService.findByName(nome);

      if (!existing) {
        await this.rolesService.create(
          nome,
          ROLE_DESCRIPTIONS[nome],
          resolve(defaults, permissions.byCode),
        );
        this.logger.log(`Perfil criado: ${nome}`);
        continue;
      }

      const newlyCreated = defaults.filter((code) => permissions.created.has(code));
      await this.rolesService.addPermissions(existing, resolve(newlyCreated, permissions.byCode));
    }
  }

  /**
   * Cria as chaves do catalogo que ainda nao existem, com o valor padrao.
   *
   * NUNCA sobrescreve o valor de uma chave existente: o que o administrador
   * alterou pela tela permanece em todos os boots seguintes. Chave removida do
   * catalogo tambem nao e apagada - remover configuracao e mudanca de dados e
   * pede uma migration propria, nao um efeito colateral do boot.
   */
  private async seedSettings(): Promise<void> {
    for (const definicao of SETTING_CATALOG) {
      if (await this.settingsRepository.findByKey(definicao.chave)) {
        continue;
      }
      await this.settingsRepository.create({
        chave: definicao.chave,
        valor: serializeSettingValue(definicao.padrao),
        descricao: definicao.descricao,
        tipo: definicao.tipo,
      });
      this.logger.log(`Configuracao criada: ${definicao.chave}`);
    }
  }

  private async seedAdmin(): Promise<void> {
    const email = this.config.get('SEED_ADMIN_EMAIL', { infer: true });
    const senha = this.config.get('SEED_ADMIN_PASSWORD', { infer: true });
    if (!email || !senha) {
      return;
    }

    if (await this.usersService.findByEmail(email)) {
      return;
    }

    if (!isPasswordValid(senha)) {
      throw new Error(`SEED_ADMIN_PASSWORD invalida. ${PASSWORD_POLICY_MESSAGE}`);
    }

    await this.usersService.create({
      nome: this.config.get('SEED_ADMIN_NAME', { infer: true }),
      email,
      senha,
      role: RoleName.Admin,
    });
    this.logger.log(`Administrador inicial criado: ${email}`);
  }
}

function resolve(codes: PermissionCode[], byCode: Map<string, Permission>): Permission[] {
  return codes.flatMap((code) => byCode.get(code) ?? []);
}
