import { RoleName } from '../roles/role-name.enum';
import { canGrantRole, canManageUser, type Actor, type RoleGrant } from './user-access.policy';

const GESTOR_PERMISSIONS = ['users:read', 'users:create', 'users:update', 'audit:read'];

const admin: Actor = { id: 'a', role: RoleName.Admin, permissions: [] };
const gestor: Actor = { id: 'g', role: RoleName.Gestor, permissions: GESTOR_PERMISSIONS };

const role = (nome: RoleName, permissions: string[] = []): RoleGrant => ({ nome, permissions });

describe('canGrantRole', () => {
  it('ADMIN concede qualquer perfil, inclusive ADMIN', () => {
    for (const nome of Object.values(RoleName)) {
      expect(canGrantRole(admin, role(nome))).toBe(true);
    }
  });

  it('ADMIN e reconhecido pelo nome, mesmo sem permissoes gravadas no banco', () => {
    expect(canGrantRole(admin, role(RoleName.Gestor, GESTOR_PERMISSIONS))).toBe(true);
  });

  it('quem nao e ADMIN nunca concede ADMIN, mesmo que ADMIN nao tenha permissoes no banco', () => {
    expect(canGrantRole(gestor, role(RoleName.Admin, []))).toBe(false);
  });

  it('concede perfil cujas permissoes sao subconjunto estrito das do ator', () => {
    expect(canGrantRole(gestor, role(RoleName.Usuario))).toBe(true);
    expect(canGrantRole(gestor, role(RoleName.Operador, ['users:read']))).toBe(true);
  });

  it('nao concede um perfil equivalente ao proprio (par)', () => {
    expect(canGrantRole(gestor, role(RoleName.Gestor, GESTOR_PERMISSIONS))).toBe(false);
  });

  it('nao concede permissao que o ator nao possui', () => {
    expect(canGrantRole(gestor, role(RoleName.Operador, ['users:role']))).toBe(false);
  });

  it('ator sem permissoes nao concede nem o perfil mais basico', () => {
    const usuario: Actor = { id: 'u', role: RoleName.Usuario, permissions: [] };
    expect(canGrantRole(usuario, role(RoleName.Usuario))).toBe(false);
  });

  it('permissoes repetidas nao distorcem a comparacao', () => {
    const duplicated: Actor = { ...gestor, permissions: ['users:read', 'users:read'] };
    expect(canGrantRole(duplicated, role(RoleName.Operador, ['users:read']))).toBe(false);
  });
});

describe('canManageUser', () => {
  it('segue a mesma regra de canGrantRole sobre o perfil atual do alvo', () => {
    expect(canManageUser(gestor, role(RoleName.Usuario))).toBe(true);
    expect(canManageUser(gestor, role(RoleName.Gestor, GESTOR_PERMISSIONS))).toBe(false);
    expect(canManageUser(gestor, role(RoleName.Admin))).toBe(false);
    expect(canManageUser(admin, role(RoleName.Admin))).toBe(true);
  });
});
