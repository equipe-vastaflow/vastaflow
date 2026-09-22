import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation';
import { buildDataSourceOptions } from './database.config';

/**
 * DataSource usado APENAS pelo CLI do TypeORM (scripts `migration:*` e
 * `schema:log` do package.json). A aplicacao usa o `DatabaseModule`.
 *
 * Le o mesmo `backend/.env` da aplicacao, com a mesma validacao. O loader
 * nativo do Node (`process.loadEnvFile`) evita depender do dotenv; variaveis ja
 * definidas no ambiente (ex.: pipeline de deploy) nao sao sobrescritas.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // Sem .env: as variaveis devem vir do proprio ambiente.
}

const env = validateEnv(process.env);

export default new DataSource({
  ...buildDataSourceOptions(env),
  // Nunca sincronizar pelo CLI: com `DATABASE_SYNCHRONIZE=true` no .env de
  // desenvolvimento, o TypeORM criaria as tabelas ao conectar e a migration
  // seguinte falharia tentando cria-las de novo.
  synchronize: false,
});
