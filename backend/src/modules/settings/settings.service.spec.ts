import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoleName } from '../roles/role-name.enum';
import type { UserDirectoryService } from '../users/user-directory.service';
import type { SystemSetting } from './entities/system-setting.entity';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';
import { SystemSettingType } from './system-setting.enums';

const ACTOR: AuthenticatedUser = {
  id: 'user-1',
  nome: 'Maria Silva',
  email: 'maria@example.com',
  role: RoleName.Admin,
  permissions: [],
  ativo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const IDENTIDADE = { id: ACTOR.id, nome: ACTOR.nome, email: ACTOR.email };

function setting(overrides: Partial<SystemSetting> = {}): SystemSetting {
  return {
    id: 'setting-1',
    chave: 'SYSTEM_NAME',
    valor: 'VastaFlow',
    descricao: 'Nome do sistema',
    tipo: SystemSettingType.String,
    atualizadoPorId: null,
    createdAt: new Date('2026-09-20T10:00:00.000Z'),
    updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    ...overrides,
  };
}

const NUMERICA = setting({
  id: 'setting-2',
  chave: 'PAGINATION_DEFAULT_LIMIT',
  valor: '20',
  tipo: SystemSettingType.Number,
});

const BOOLEANA = setting({
  id: 'setting-3',
  chave: 'FEATURE_ENABLED',
  valor: 'false',
  tipo: SystemSettingType.Boolean,
});

describe('SettingsService', () => {
  let repository: jest.Mocked<Pick<SettingsRepository, 'findAll' | 'findByKey' | 'save'>>;
  let userDirectory: jest.Mocked<Pick<UserDirectoryService, 'findByIds'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: SettingsService;

  beforeEach(() => {
    repository = {
      findAll: jest.fn().mockResolvedValue([setting(), NUMERICA]),
      findByKey: jest.fn().mockResolvedValue(setting()),
      save: jest.fn().mockImplementation((s: SystemSetting) => Promise.resolve(s)),
    };
    userDirectory = { findByIds: jest.fn().mockResolvedValue(new Map([[ACTOR.id, IDENTIDADE]])) };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new SettingsService(
      repository as unknown as SettingsRepository,
      userDirectory as unknown as UserDirectoryService,
      auditService as unknown as AuditService,
    );
  });

  describe('list', () => {
    it('devolve todas as configuracoes com o valor ja tipado', async () => {
      const itens = await service.list();

      expect(itens).toHaveLength(2);
      expect(itens[0].valor).toBe('VastaFlow');
      expect(itens[1].valor).toBe(20);
      expect(typeof itens[1].valor).toBe('number');
    });

    it('resolve os responsaveis em UMA consulta, nao uma por configuracao', async () => {
      repository.findAll.mockResolvedValue([
        setting({ id: 'a', chave: 'A', atualizadoPorId: ACTOR.id }),
        setting({ id: 'b', chave: 'B', atualizadoPorId: ACTOR.id }),
        setting({ id: 'c', chave: 'C', atualizadoPorId: 'outro' }),
      ]);

      await service.list();

      expect(userDirectory.findByIds).toHaveBeenCalledTimes(1);
      expect(userDirectory.findByIds).toHaveBeenCalledWith([ACTOR.id, ACTOR.id, 'outro']);
    });

    it('nao consulta o diretorio quando ninguem alterou nada ainda', async () => {
      await service.list();

      expect(userDirectory.findByIds).toHaveBeenCalledWith([]);
    });

    it('a configuracao nunca alterada vem sem responsavel', async () => {
      const [primeiro] = await service.list();

      expect(primeiro.setting.atualizadoPorId).toBeNull();
      expect(primeiro.atualizadoPor).toBeUndefined();
    });

    it('responsavel que nao existe mais some do resultado, mas o id permanece', async () => {
      repository.findAll.mockResolvedValue([setting({ atualizadoPorId: 'apagado' })]);
      userDirectory.findByIds.mockResolvedValue(new Map());

      const [item] = await service.list();

      expect(item.setting.atualizadoPorId).toBe('apagado');
      expect(item.atualizadoPor).toBeUndefined();
    });
  });

  describe('get', () => {
    it.each([
      ['STRING', setting(), 'VastaFlow'],
      ['NUMBER', NUMERICA, 20],
      ['BOOLEAN', BOOLEANA, false],
    ])('converte o valor de uma configuracao %s', async (_nome, linha, esperado) => {
      repository.findByKey.mockResolvedValue(linha);

      const { valor } = await service.get(linha.chave);

      expect(valor).toBe(esperado);
    });

    it('chave inexistente: NotFoundException', async () => {
      repository.findByKey.mockResolvedValue(null);

      await expect(service.get('NAO_EXISTE')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('grava o novo valor e registra quem alterou', async () => {
      const { setting: salvo, valor } = await service.update(ACTOR, 'SYSTEM_NAME', 'Outro', null);

      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(salvo.valor).toBe('Outro');
      expect(salvo.atualizadoPorId).toBe(ACTOR.id);
      expect(valor).toBe('Outro');
    });

    it.each([
      ['NUMBER', NUMERICA, 50, '50'],
      ['BOOLEAN', BOOLEANA, true, 'true'],
    ])('serializa o valor %s antes de gravar', async (_nome, linha, entrada, gravado) => {
      repository.findByKey.mockResolvedValue(linha);

      const { setting: salvo, valor } = await service.update(ACTOR, linha.chave, entrada, null);

      expect(salvo.valor).toBe(gravado);
      expect(valor).toBe(entrada);
    });

    it('remove espacos nas pontas de um valor de texto', async () => {
      const { setting: salvo } = await service.update(ACTOR, 'SYSTEM_NAME', '  Outro  ', null);

      expect(salvo.valor).toBe('Outro');
    });

    it('chave inexistente: NotFoundException, sem gravar nem auditar', async () => {
      repository.findByKey.mockResolvedValue(null);

      await expect(service.update(ACTOR, 'NAO_EXISTE', 'x', null)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    describe('valor incompativel com o tipo declarado', () => {
      it.each([
        ['numero numa configuracao STRING', setting(), 20],
        ['booleano numa configuracao STRING', setting(), true],
        ['texto vazio numa configuracao STRING', setting(), '   '],
        ['texto numa configuracao NUMBER', NUMERICA, '50'],
        ['NaN numa configuracao NUMBER', NUMERICA, Number.NaN],
        ['Infinity numa configuracao NUMBER', NUMERICA, Number.POSITIVE_INFINITY],
        ['a string "false" numa configuracao BOOLEAN', BOOLEANA, 'false'],
        ['o numero 1 numa configuracao BOOLEAN', BOOLEANA, 1],
      ])('recusa %s com BadRequestException', async (_nome, linha, entrada) => {
        repository.findByKey.mockResolvedValue(linha);

        await expect(service.update(ACTOR, linha.chave, entrada, null)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        // A recusa acontece ANTES de qualquer escrita.
        expect(repository.save).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
      });

      it('a mensagem diz a chave e o tipo esperado', async () => {
        repository.findByKey.mockResolvedValue(BOOLEANA);

        await expect(service.update(ACTOR, BOOLEANA.chave, 'false', null)).rejects.toThrow(
          /FEATURE_ENABLED \(BOOLEAN\)/,
        );
      });
    });

    it('mesmo valor: responde sem gravar e sem auditar', async () => {
      const { valor } = await service.update(ACTOR, 'SYSTEM_NAME', 'VastaFlow', null);

      expect(valor).toBe('VastaFlow');
      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('o responsavel vem do ator autenticado, nunca de um parametro do cliente', async () => {
      const { setting: salvo } = await service.update(ACTOR, 'SYSTEM_NAME', 'Outro', null);

      expect(salvo.atualizadoPorId).toBe(ACTOR.id);
    });

    it('nao altera chave, tipo nem descricao', async () => {
      repository.findByKey.mockResolvedValue(setting());

      const { setting: salvo } = await service.update(ACTOR, 'SYSTEM_NAME', 'Outro', null);

      expect(salvo.chave).toBe('SYSTEM_NAME');
      expect(salvo.tipo).toBe(SystemSettingType.String);
      expect(salvo.descricao).toBe('Nome do sistema');
    });
  });

  describe('auditoria', () => {
    it('registra exatamente SYSTEM_SETTING_UPDATED no modulo SETTINGS', async () => {
      await service.update(ACTOR, 'SYSTEM_NAME', 'Outro', '10.0.0.5');

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: ACTOR.id,
          acao: AuditAction.SystemSettingUpdated,
          modulo: AuditModuleName.Settings,
          ip: '10.0.0.5',
          metadados: {
            alvoId: 'setting-1',
            chave: 'SYSTEM_NAME',
            tipo: SystemSettingType.String,
          },
        }),
      );
    });

    it('a descricao informa qual chave mudou', async () => {
      await service.update(ACTOR, 'SYSTEM_NAME', 'Outro', null);

      const [[evento]] = auditService.record.mock.calls;
      expect(evento.descricao).toContain('SYSTEM_NAME');
    });

    /**
     * A trilha registra QUE a configuracao mudou, nunca PARA QUANTO. Hoje
     * nenhuma configuracao guarda segredo, e a regra vale de antemao para que
     * nunca passe a guardar por descuido.
     */
    it('nem a descricao nem os metadados contem o valor antigo ou o novo', async () => {
      repository.findByKey.mockResolvedValue(setting({ valor: 'ValorAntigo' }));

      await service.update(ACTOR, 'SYSTEM_NAME', 'ValorNovo', null);

      const [[evento]] = auditService.record.mock.calls;
      const registro = JSON.stringify(evento);
      expect(registro).not.toContain('ValorAntigo');
      expect(registro).not.toContain('ValorNovo');
    });
  });

  describe('auditoria best-effort', () => {
    /**
     * Usa o `AuditService` REAL com um repositorio que falha, e nao um mock que
     * rejeita: a politica best-effort e do proprio AuditService (ele captura e
     * loga), como no financeiro e em usuarios.
     */
    it('falha ao gravar a auditoria nao derruba a alteracao', async () => {
      const auditRepository = {
        create: jest.fn().mockRejectedValue(new Error('banco de auditoria indisponivel')),
      };
      const real = new AuditService(
        auditRepository as unknown as AuditRepository,
        userDirectory as unknown as UserDirectoryService,
      );
      jest.spyOn(real['logger'], 'error').mockImplementation(() => undefined);

      const comAuditoriaQuebrada = new SettingsService(
        repository as unknown as SettingsRepository,
        userDirectory as unknown as UserDirectoryService,
        real,
      );

      const { setting: salvo } = await comAuditoriaQuebrada.update(
        ACTOR,
        'SYSTEM_NAME',
        'Outro',
        null,
      );

      expect(salvo.valor).toBe('Outro');
      expect(repository.save).toHaveBeenCalledTimes(1);
    });
  });
});
