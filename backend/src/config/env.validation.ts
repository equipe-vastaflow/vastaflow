import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
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
 * Contrato das variaveis de ambiente consumidas pelo backend.
 *
 * Apenas as variaveis efetivamente usadas pelo codigo sao validadas aqui.
 * As variaveis de banco (Etapa 2) e de autenticacao (Etapa 3) existem no
 * `.env.example`, mas so passam a ser exigidas quando os respectivos modulos
 * forem implementados - validar antes disso impediria a aplicacao de subir
 * sem necessidade.
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
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
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

  if (errors.length > 0) {
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`)
      .join('\n');

    throw new Error(
      `Configuracao de ambiente invalida. Verifique o arquivo .env (modelo em .env.example):\n${details}`,
    );
  }

  return parsed;
}
