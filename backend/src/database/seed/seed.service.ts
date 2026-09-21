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
import { isPasswordValid, PASSWORD_POLICY_MESSAGE } from '../../modules/users/password.policy';
import { UsersService } from '../../modules/users/users.service';

/**
 * Dados iniciais, executados a cada boot e idempotentes: so criam o que falta.
 *
 * 1. Permissoes do catalogo (`PermissionCode`);
 * 2. Perfis (`RoleName`) com as permissoes padrao;
 * 3. Administrador inicial, se `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` estiverem definidos.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly rolesService: RolesService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedAccessControl();
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
