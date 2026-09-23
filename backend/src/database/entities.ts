import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { FinancialEntry } from '../modules/finance/entities/financial-entry.entity';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Role } from '../modules/roles/entities/role.entity';
import { User } from '../modules/users/entities/user.entity';

/**
 * Todas as entities persistidas.
 *
 * Fonte unica usada pela aplicacao, pelo CLI de migrations e pelos testes de
 * compatibilidade MySQL/Oracle. Entity nova precisa entrar aqui (alem do
 * `TypeOrmModule.forFeature` do seu modulo) - do contrario o CLI nao a enxerga
 * e nenhuma migration e gerada para ela.
 */
export const ENTITIES = [Permission, Role, User, AuditLog, FinancialEntry];
