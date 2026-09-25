import { NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoleName } from '../roles/role-name.enum';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import type { UserDirectoryService } from './user-directory.service';
import { UsersRepository } from './users.repository';

const ACTOR: AuthenticatedUser = {
  id: 'user-1',
  nome: 'Maria Silva',
  email: 'maria@example.com',
  role: RoleName.Usuario,
  permissions: [],
  ativo: true,
  createdAt: new Date('2026-03-10T12:00:00.000Z'),
  updatedAt: new Date('2026-03-10T12:00:00.000Z'),
};

describe('ProfileService', () => {
  let repository: jest.Mocked<Pick<UsersRepository, 'updateName' | 'findById'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: ProfileService;

  beforeEach(() => {
    repository = {
      updateName: jest.fn().mockResolvedValue(1),
      findById: jest.fn(),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new ProfileService(
      repository as unknown as UsersRepository,
      auditService as unknown as AuditService,
    );
  });

  describe('origem da identidade', () => {
    it('grava sempre com o id do ator autenticado', async () => {
      await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      expect(repository.updateName).toHaveBeenCalledWith(ACTOR.id, 'Maria Souza', expect.any(Date));
    });

    /**
     * Prova que a identidade vem do ator, e nao do corpo: mesmo que um campo de
     * usuario escapasse do `ValidationPipe` (que hoje os recusa com 400), o
     * service nunca o consulta - ele so conhece `actor.id`.
     */
    it('ignora qualquer identificador que venha no corpo', async () => {
      const comIntruso = {
        nome: 'Maria Souza',
        id: 'id-de-outra-pessoa',
        userId: 'id-de-outra-pessoa',
        usuarioId: 'id-de-outra-pessoa',
      } as UpdateProfileDto;

      await service.update(ACTOR, comIntruso, null);

      expect(repository.updateName).toHaveBeenCalledWith(ACTOR.id, 'Maria Souza', expect.any(Date));
      expect(repository.updateName).not.toHaveBeenCalledWith(
        'id-de-outra-pessoa',
        expect.anything(),
        expect.anything(),
      );
    });

    it('troca de ator: grava no id do novo ator, sem nenhum estado preso', async () => {
      const outro: AuthenticatedUser = { ...ACTOR, id: 'user-2', nome: 'Joao Lima' };

      await service.update(ACTOR, { nome: 'Maria Souza' }, null);
      await service.update(outro, { nome: 'Joao Souza' }, null);

      expect(repository.updateName).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'Maria Souza',
        expect.any(Date),
      );
      expect(repository.updateName).toHaveBeenNthCalledWith(
        2,
        'user-2',
        'Joao Souza',
        expect.any(Date),
      );
    });

    it('a auditoria aponta para o proprio ator', async () => {
      await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      const [[evento]] = auditService.record.mock.calls;
      expect(evento.usuarioId).toBe(ACTOR.id);
      expect((evento.metadados as { alvoId: string }).alvoId).toBe(ACTOR.id);
    });
  });

  describe('gravacao direcionada', () => {
    /**
     * O nucleo da correcao: a persistencia e um UPDATE de UMA coluna, e nao
     * `save(entity)`. Com `save`, uma alteracao administrativa concorrente
     * (`ativo`, `role_id`, `senha_hash`, `email`) seria reescrita com os
     * valores antigos da entidade carregada.
     */
    it('usa o UPDATE direcionado, nunca o save da entidade inteira', async () => {
      await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      expect(repository.updateName).toHaveBeenCalledTimes(1);
      // Tres argumentos: id, nome e data. Nenhuma coluna administrativa
      // atravessa a fronteira do repositorio.
      expect(repository.updateName.mock.calls[0]).toHaveLength(3);
    });

    it('nao carrega a entidade para gravar', async () => {
      await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('devolve o perfil com o nome novo e as demais colunas intactas', async () => {
      const salvo = await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      expect(salvo.nome).toBe('Maria Souza');
      expect(salvo).toMatchObject({
        id: ACTOR.id,
        email: ACTOR.email,
        role: ACTOR.role,
        ativo: ACTOR.ativo,
        createdAt: ACTOR.createdAt,
      });
    });

    it('a data gravada e a mesma devolvida na resposta', async () => {
      const salvo = await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      const [, , quando] = repository.updateName.mock.calls[0];
      expect(salvo.updatedAt).toBe(quando);
      expect(salvo.updatedAt).not.toEqual(ACTOR.updatedAt);
    });

    it('conta apagada entre a autenticacao e a gravacao: NotFoundException', async () => {
      repository.updateName.mockResolvedValue(0);

      await expect(service.update(ACTOR, { nome: 'Outro' }, null)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // Nenhuma linha alcancada: nada entra na trilha.
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('operacao sem efeito', () => {
    /**
     * A prova de que nada foi gravado e a AUSENCIA da chamada de persistencia -
     * nao a comparacao de um timestamp, que depende da precisao do banco.
     */
    it('corpo vazio: nao grava e nao audita', async () => {
      const salvo = await service.update(ACTOR, {}, null);

      expect(repository.updateName).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(salvo).toEqual(ACTOR);
    });

    it('mesmo nome: nao grava e nao audita', async () => {
      const salvo = await service.update(ACTOR, { nome: ACTOR.nome }, null);

      expect(repository.updateName).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(salvo).toEqual(ACTOR);
    });

    it('repetir a mesma alteracao e seguro: a segunda vez nao grava', async () => {
      const depoisDaPrimeira = await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      await service.update(depoisDaPrimeira, { nome: 'Maria Souza' }, null);

      expect(repository.updateName).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('auditoria', () => {
    it('reusa USER_UPDATED no modulo USERS, com os campos alterados', async () => {
      await service.update(ACTOR, { nome: 'Maria Souza' }, '10.0.0.5');

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: ACTOR.id,
          acao: AuditAction.UserUpdated,
          modulo: AuditModuleName.Users,
          ip: '10.0.0.5',
          metadados: { alvoId: ACTOR.id, campos: ['nome'] },
        }),
      );
    });

    it('a trilha guarda o NOME do campo, nunca o valor antigo ou o novo', async () => {
      await service.update(ACTOR, { nome: 'Nome Novo' }, null);

      const [[evento]] = auditService.record.mock.calls;
      const registro = JSON.stringify(evento);
      expect(registro).toContain('nome');
      expect(registro).not.toContain('Maria Silva');
      expect(registro).not.toContain('Nome Novo');
    });

    it('a trilha nao contem e-mail nem senha', async () => {
      await service.update(ACTOR, { nome: 'Maria Souza' }, null);

      const [[evento]] = auditService.record.mock.calls;
      const registro = JSON.stringify(evento);
      expect(registro).not.toContain('@example.com');
      expect(registro.toLowerCase()).not.toContain('senha');
    });
  });

  describe('auditoria best-effort', () => {
    /**
     * Usa o `AuditService` REAL com um repositorio que falha, e nao um mock que
     * rejeita: a politica best-effort e do proprio AuditService (ele captura e
     * loga), como no financeiro, em configuracoes e na administracao de usuarios.
     */
    it('falha ao gravar a auditoria nao impede a atualizacao', async () => {
      const auditRepository = {
        create: jest.fn().mockRejectedValue(new Error('banco de auditoria indisponivel')),
      };
      const real = new AuditService(
        auditRepository as unknown as AuditRepository,
        { findByIds: jest.fn() } as unknown as UserDirectoryService,
      );
      jest.spyOn(real['logger'], 'error').mockImplementation(() => undefined);

      const comAuditoriaQuebrada = new ProfileService(
        repository as unknown as UsersRepository,
        real,
      );

      const salvo = await comAuditoriaQuebrada.update(ACTOR, { nome: 'Maria Souza' }, null);

      expect(salvo.nome).toBe('Maria Souza');
      expect(repository.updateName).toHaveBeenCalledTimes(1);
    });
  });
});
