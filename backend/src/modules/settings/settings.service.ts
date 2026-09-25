import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UserDirectoryService, type UserIdentity } from '../users/user-directory.service';
import type { SystemSetting } from './entities/system-setting.entity';
import {
  parseSettingValue,
  readSettingValue,
  serializeSettingValue,
  type SettingValue,
} from './setting-value';
import { SettingsRepository } from './settings.repository';

/** Configuracao com o valor ja tipado e o responsavel resolvido. */
export interface SettingWithActor {
  setting: SystemSetting;
  /** Valor convertido conforme o `tipo` declarado. */
  valor: SettingValue;
  /** Ausente quando ninguem alterou ainda, ou quando o usuario nao existe mais. */
  atualizadoPor?: UserIdentity;
}

/**
 * Administracao das configuracoes do sistema.
 *
 * As rotas ja passaram pelo `PermissionsGuard` (`settings:read` / `settings:update`).
 * Aqui ficam as regras que o guard nao conhece: a chave precisa existir e o
 * valor precisa corresponder ao tipo declarado.
 *
 * SOMENTE O VALOR muda. Chave, tipo e descricao vem do catalogo em codigo e nao
 * sao editaveis pela API - o DTO nao os aceita e o `ValidationPipe` global
 * recusa campo fora dele com 400. O responsavel tambem nao vem do cliente:
 * e sempre o usuario autenticado recebido como `actor`.
 *
 * A auditoria e BEST-EFFORT, como no restante do sistema: e gravada depois da
 * alteracao e uma falha ao grava-la vai para o log sem desfazer a operacao nem
 * mudar a resposta. Alteracao sem efeito (mesmo valor) responde normalmente e
 * nao gera registro - mesmo criterio ja usado no financeiro e em usuarios.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly userDirectory: UserDirectoryService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Todas as configuracoes.
   *
   * Duas consultas, sempre: a listagem e UMA busca em lote dos responsaveis -
   * nunca uma consulta por configuracao.
   */
  async list(): Promise<SettingWithActor[]> {
    return this.withActors(await this.repository.findAll());
  }

  /** @throws NotFoundException chave fora do catalogo. */
  async get(chave: string): Promise<SettingWithActor> {
    const setting = await this.findOrFail(chave);
    return this.withActor(setting);
  }

  /**
   * Altera o valor de uma configuracao.
   *
   * @throws NotFoundException chave fora do catalogo.
   * @throws BadRequestException valor incompativel com o tipo declarado.
   */
  async update(
    actor: AuthenticatedUser,
    chave: string,
    raw: unknown,
    ip: string | null,
  ): Promise<SettingWithActor> {
    const setting = await this.findOrFail(chave);

    // A validacao acontece ANTES de qualquer escrita: valor invalido nao chega
    // ao banco nem gera registro de auditoria.
    const parsed = parseSettingValue(setting.tipo, raw);
    if (!parsed.ok) {
      throw new BadRequestException(`${setting.chave} (${setting.tipo}): ${parsed.erro}`);
    }

    const texto = serializeSettingValue(parsed.value);
    if (texto === setting.valor) {
      // Sem efeito: responde o estado atual, sem gravar nem auditar.
      return this.withActor(setting);
    }

    setting.valor = texto;
    setting.atualizadoPorId = actor.id;
    const salvo = await this.repository.save(setting);

    await this.auditService.record({
      usuarioId: actor.id,
      acao: AuditAction.SystemSettingUpdated,
      modulo: AuditModuleName.Settings,
      // A chave identifica o que mudou. O valor - anterior ou novo - NAO entra
      // na trilha: hoje nenhuma configuracao guarda segredo, e a regra vale de
      // antemao para que nunca passe a guardar por descuido.
      descricao: `Configuracao ${salvo.chave} atualizada por ${actor.email}`,
      ip,
      metadados: { alvoId: salvo.id, chave: salvo.chave, tipo: salvo.tipo },
    });

    return this.withActor(salvo);
  }

  private async findOrFail(chave: string): Promise<SystemSetting> {
    const setting = await this.repository.findByKey(chave);
    if (!setting) {
      throw new NotFoundException('Configuracao nao encontrada');
    }
    return setting;
  }

  private async withActor(setting: SystemSetting): Promise<SettingWithActor> {
    const [item] = await this.withActors([setting]);
    return item;
  }

  /** Resolve os responsaveis em UMA consulta, nunca uma por configuracao. */
  private async withActors(settings: SystemSetting[]): Promise<SettingWithActor[]> {
    const ids = settings
      .map((setting) => setting.atualizadoPorId)
      .filter((id): id is string => id !== null);
    const autores = await this.userDirectory.findByIds(ids);

    return settings.map((setting) => ({
      setting,
      valor: readSettingValue(setting.tipo, setting.valor),
      atualizadoPor:
        setting.atualizadoPorId === null ? undefined : autores.get(setting.atualizadoPorId),
    }));
  }
}
