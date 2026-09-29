import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Valor bruto recebido do ambiente.
 *
 * `TransformFnParams.value` e tipado como `any` pelo class-transformer;
 * estreitar para `unknown` obriga cada transformacao a tratar o valor
 * explicitamente, em vez de propagar `any` pelo codigo.
 */
type TransformInput = { value: unknown };

/**
 * Ambientes de execucao suportados pela aplicacao.
 */
export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Bancos de dados suportados pela camada de persistencia (ADR 0001).
 */
export enum DatabaseType {
  Mysql = 'mysql',
  Oracle = 'oracle',
}

/**
 * Contrato das variaveis de ambiente consumidas pelo backend.
 *
 * Apenas as variaveis efetivamente usadas pelo codigo sao validadas aqui.
 * Variaveis de integracoes externas existem no `.env.example` apenas como
 * reserva de nome e so passam a ser exigidas quando o respectivo modulo for
 * implementado - validar antes disso impediria a aplicacao de subir sem
 * necessidade.
 */
export class EnvironmentVariables {
  @Transform(({ value }: TransformInput): unknown =>
    isBlank(value) ? Environment.Development : value,
  )
  @IsEnum(Environment, {
    message: `NODE_ENV deve ser um destes valores: ${Object.values(Environment).join(', ')}`,
  })
  NODE_ENV: Environment = Environment.Development;

  @Transform(({ value }: TransformInput): number => (isBlank(value) ? 3000 : Number(value)))
  @IsInt({ message: 'PORT deve ser um numero inteiro' })
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @Transform(({ value }: TransformInput): string => {
    // Espacos em branco equivalem a variavel nao informada (`APP_NAME=` no .env).
    const trimmed = typeof value === 'string' ? value.trim() : value;
    return isBlank(trimmed) ? 'vasta-flow' : String(trimmed);
  })
  @IsString()
  @IsNotEmpty()
  APP_NAME: string = 'vasta-flow';

  @Transform(({ value }: TransformInput): boolean =>
    isBlank(value) ? true : value === 'true' || value === true,
  )
  @IsBoolean({ message: "SWAGGER_ENABLED deve ser 'true' ou 'false'" })
  SWAGGER_ENABLED: boolean = true;

  /**
   * Origens autorizadas a chamar a API pelo navegador (CORS), separadas por
   * virgula. Vazio mantem o CORS desabilitado.
   */
  @Transform(({ value }: TransformInput): string => (typeof value === 'string' ? value.trim() : ''))
  @IsString()
  FRONTEND_ORIGIN: string = '';

  // ---------------------------------------------------------------------
  // Banco de dados
  // ---------------------------------------------------------------------

  @Transform(({ value }: TransformInput): unknown => (isBlank(value) ? DatabaseType.Mysql : value))
  @IsEnum(DatabaseType, {
    message: `DATABASE_TYPE deve ser um destes valores: ${Object.values(DatabaseType).join(', ')}`,
  })
  DATABASE_TYPE: DatabaseType = DatabaseType.Mysql;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_HOST?: string;

  /** Padrao por driver (3306 MySQL, 1521 Oracle) resolvido na camada de banco. */
  @Transform(({ value }: TransformInput): number | undefined =>
    isBlank(value) ? undefined : Number(value),
  )
  @IsOptional()
  @IsInt({ message: 'DATABASE_PORT deve ser um numero inteiro' })
  @Min(1)
  @Max(65535)
  DATABASE_PORT?: number;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_NAME?: string;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_USER?: string;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_PASSWORD?: string;

  /** Quando informada, tem precedencia sobre HOST/PORT/NAME/USER/PASSWORD. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_ORACLE_SID?: string;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_ORACLE_SERVICE_NAME?: string;

  /**
   * Cria/altera o schema automaticamente a partir das entities. Util em
   * desenvolvimento; proibido em producao (ver `validateDatabaseSettings`).
   * As migrations por banco (ADR 0001) substituem isto no hardening.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "DATABASE_SYNCHRONIZE deve ser 'true' ou 'false'" })
  DATABASE_SYNCHRONIZE: boolean = false;

  // ---------------------------------------------------------------------
  // Autenticacao
  // ---------------------------------------------------------------------

  /** Sem valor padrao de proposito: um segredo default seria uma falha de seguranca. */
  @IsString({ message: 'JWT_SECRET e obrigatorio' })
  @MinLength(32, { message: 'JWT_SECRET deve ter ao menos 32 caracteres' })
  JWT_SECRET!: string;

  /** Formato `<numero><s|m|h|d>`, ex.: 15m, 1h, 7d. */
  @Transform(({ value }: TransformInput): unknown => (isBlank(value) ? '1h' : value))
  @Matches(/^\d+[smhd]$/, { message: 'JWT_EXPIRES_IN deve seguir o formato 15m, 1h, 7d' })
  JWT_EXPIRES_IN: string = '1h';

  @Transform(({ value }: TransformInput): number => (isBlank(value) ? 12 : Number(value)))
  @IsInt({ message: 'BCRYPT_SALT_ROUNDS deve ser um numero inteiro' })
  @Min(4)
  @Max(15)
  BCRYPT_SALT_ROUNDS: number = 12;

  // ---------------------------------------------------------------------
  // Administrador inicial (opcional)
  //
  // Sem estas variaveis nenhum usuario ADMIN e criado. O cadastro publico
  // (POST /auth/register) so cria usuarios comuns, entao esta e a unica forma
  // de obter o primeiro administrador.
  // ---------------------------------------------------------------------

  @Transform(optionalString)
  @IsOptional()
  @IsEmail({}, { message: 'SEED_ADMIN_EMAIL deve ser um e-mail valido' })
  SEED_ADMIN_EMAIL?: string;

  @Transform(optionalString)
  @IsOptional()
  @IsString()
  SEED_ADMIN_PASSWORD?: string;

  @Transform(({ value }: TransformInput): string => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed === '' ? 'Administrador' : trimmed;
  })
  @IsString()
  @MaxLength(120)
  SEED_ADMIN_NAME: string = 'Administrador';

  // ---------------------------------------------------------------------
  // Integracao: Telegram
  // ---------------------------------------------------------------------

  /**
   * Token do bot, emitido pelo @BotFather. Opcional: sem ele a integracao fica
   * `NOT_CONFIGURED` e a aplicacao sobe normalmente. E SEGREDO - nunca vai para
   * log, resposta, relatorio de status nem mensagem de erro.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  /**
   * Liga o recebimento de mensagens por long polling (`getUpdates`). Opt-in:
   * o token sozinho NAO liga o polling, para que um ambiente com o token (dev,
   * homologacao) nao dispute as mensagens do bot com outro - o Telegram recusa
   * dois `getUpdates` simultaneos para o mesmo bot.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "TELEGRAM_POLLING_ENABLED deve ser 'true' ou 'false'" })
  TELEGRAM_POLLING_ENABLED: boolean = false;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Texto opcional: espacos ao redor sao removidos e vazio vira `undefined`. */
function optionalString({ value }: TransformInput): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Regras que envolvem mais de uma variavel e, por isso, nao cabem em
 * decorators de propriedade. Devolve uma lista de problemas encontrados.
 */
function validateCrossFieldRules(env: EnvironmentVariables): string[] {
  const problems: string[] = [];

  if (!env.DATABASE_URL) {
    const missing = (
      ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'] as const
    ).filter((key) => !env[key]);
    if (missing.length > 0) {
      problems.push(`banco de dados: informe DATABASE_URL ou preencha ${missing.join(', ')}`);
    }

    if (env.DATABASE_TYPE === DatabaseType.Oracle) {
      const hasSid = Boolean(env.DATABASE_ORACLE_SID);
      const hasService = Boolean(env.DATABASE_ORACLE_SERVICE_NAME);
      if (hasSid === hasService) {
        problems.push(
          'banco de dados Oracle: preencha exatamente um entre DATABASE_ORACLE_SID e DATABASE_ORACLE_SERVICE_NAME',
        );
      }
    }
  }

  if (env.DATABASE_SYNCHRONIZE && env.NODE_ENV === Environment.Production) {
    problems.push('DATABASE_SYNCHRONIZE=true e proibido em producao (use migrations)');
  }

  if (Boolean(env.SEED_ADMIN_EMAIL) !== Boolean(env.SEED_ADMIN_PASSWORD)) {
    problems.push('SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD devem ser informados juntos');
  }

  return problems;
}

/**
 * Valida o ambiente no boot da aplicacao.
 *
 * Falha rapido: uma configuracao invalida derruba o processo na inicializacao,
 * em vez de gerar erro obscuro no primeiro request.
 */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const parsed = plainToInstance(EnvironmentVariables, raw, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(parsed, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });

  const details = errors.map(
    (error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`,
  );
  // As regras cruzadas so fazem sentido sobre campos individualmente validos.
  if (errors.length === 0) {
    details.push(...validateCrossFieldRules(parsed).map((problem) => `  - ${problem}`));
  }

  if (details.length > 0) {
    throw new Error(
      `Configuracao de ambiente invalida. Verifique o arquivo .env (modelo em .env.example):\n${details.join('\n')}`,
    );
  }

  return parsed;
}
