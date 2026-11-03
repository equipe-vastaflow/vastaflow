import { isIP } from 'node:net';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
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
import {
  isPlausibleToken,
  parsePlantaeBaseUrl,
} from '../modules/integrations/plantae/plantae-settings';
import { validateNfseSettings } from '../modules/integrations/nfse/nfse-settings';
import { validateWhatsappSettings } from '../modules/integrations/whatsapp/whatsapp-settings';
import { resolveTelegramApiBase } from '../modules/integrations/telegram/telegram-api-base';
import {
  EVENT_RETENTION_DEFAULT_DAYS,
  EVENT_RETENTION_MIN_DAYS,
} from '../modules/integrations/telegram-ingest/telegram-events.policy';
import {
  isAcceptableSigningKey,
  parseN8nWebhookUrl,
  TELEGRAM_DELIVERY_MODES,
  type TelegramDeliveryMode,
} from '../modules/integrations/telegram/telegram-n8n-settings';

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
/** Limite inicial de tamanho de documento: 10 MB. Conservador e configuravel. */
export const DEFAULT_DOCUMENT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Teto do que `DOCUMENT_MAX_FILE_SIZE` pode valer: 100 MB.
 *
 * O arquivo passa pela memoria do processo antes de ir ao storage, entao um
 * valor absurdo transformaria o endpoint em alvo de exaustao de memoria. Subir
 * deste teto exige antes trocar o upload para streaming direto ao storage.
 */
export const MAX_DOCUMENT_MAX_FILE_SIZE = 100 * 1024 * 1024;

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

  /**
   * Expoe a documentacao interativa em `/docs`.
   *
   * Padrao `false`: a documentacao descreve toda a superficie da API, incluindo
   * os schemas de entrada, e e opt-in explicito. Antes o padrao era `true`, o
   * que significava que esquecer a variavel em producao expunha tudo.
   *
   * Ligar explicitamente em producao nao reabre a porta: a regra cruzada
   * `validateCrossFieldRules` recusa a configuracao e a aplicacao nao sobe -
   * mesmo tratamento dado a `DATABASE_SYNCHRONIZE`. O `.env.example` ja traz
   * `SWAGGER_ENABLED=true`, entao o ambiente de desenvolvimento segue com a
   * documentacao disponivel.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "SWAGGER_ENABLED deve ser 'true' ou 'false'" })
  SWAGGER_ENABLED: boolean = false;

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

  /**
   * Exige TLS na conexao com o MySQL, com verificacao do certificado do
   * servidor.
   *
   * Default `false` para nao quebrar o MySQL local de desenvolvimento, que
   * normalmente nao tem TLS. Em PRODUCAO com MySQL e obrigatorio: a regra
   * cruzada recusa o boot sem ele.
   *
   * NAO existe opcao para desligar a verificacao do certificado
   * (`rejectUnauthorized: false`) - TLS sem verificar quem esta do outro lado
   * protege contra escuta passiva e nao contra um intermediario ativo, que e o
   * ataque que importa.
   *
   * Nao se aplica ao Oracle: ali o TLS e configurado na string de conexao do
   * proprio driver.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "DATABASE_SSL deve ser 'true' ou 'false'" })
  DATABASE_SSL: boolean = false;

  /**
   * CA que assina o certificado do servidor MySQL, em PEM.
   *
   * Recebe o CONTEUDO do certificado, nao um caminho: evita depender do
   * filesystem (a aplicacao nao le arquivo em nenhum outro ponto) e funciona
   * direto com gerenciadores de segredo. O certificado em si NAO e segredo -
   * a chave privada correspondente e, e ela nunca passa por aqui.
   *
   * OBRIGATORIA quando `DATABASE_SSL=true`. Antes, deixar vazio fazia o driver
   * confiar no pacote de CAs que ele embarca para a AWS; essa CA assina os
   * certificados de toda instancia RDS de todo cliente AWS, e esta instalacao
   * nao usa RDS. A regra cruzada recusa o boot, e `buildMysqlSsl` recusa a
   * montagem da configuracao.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_SSL_CA?: string;

  /**
   * Caminho de um arquivo PEM montado, alternativa a `DATABASE_SSL_CA`.
   *
   * Existe porque um PEM e multilinha, e valor multilinha em arquivo `.env`
   * lido pelo Docker Compose e fragil. Montar o arquivo somente-leitura no
   * container e a forma adequada, e `*_FILE` e a convencao que as proprias
   * imagens oficiais de banco usam.
   *
   * EXATAMENTE UMA das duas quando TLS esta ligado - nao ha precedencia. Ver
   * `database/ssl-ca.ts`.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  DATABASE_SSL_CA_FILE?: string;

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
  // ---------------------------------------------------------------------
  // Documentos
  // ---------------------------------------------------------------------

  /**
   * Onde o adapter local grava os bytes dos documentos.
   *
   * Relativo ao diretorio de trabalho do processo quando nao for absoluto. Vale
   * SOMENTE para o adapter de filesystem; quando o storage em S3 existir, ele
   * tera a propria configuracao e esta variavel deixa de ser usada.
   */
  @Transform(({ value }: TransformInput): string =>
    isBlank(value) ? './storage/documents' : String(value).trim(),
  )
  @IsString()
  @IsNotEmpty({ message: 'DOCUMENT_STORAGE_PATH nao pode ser vazio' })
  DOCUMENT_STORAGE_PATH: string = './storage/documents';

  /**
   * Tamanho maximo de UM documento, em bytes.
   *
   * ATENCAO: 10 MB e um valor inicial conservador, NAO aprovado pelo negocio -
   * nao havia decisao alguma no repositorio. Precisa ser revisto com a Vasta
   * antes do uso real, e por isso e configuravel.
   *
   * Nao confundir com o limite global de corpo de requisicao (100 kB, Fase A),
   * que continua valendo para as rotas JSON: este vale somente para o endpoint
   * multipart de documentos, e e aplicado pelo `MulterModule`.
   *
   * O minimo de 1 byte impede configurar zero ou negativo, que desabilitaria o
   * upload de um jeito dificil de diagnosticar. O maximo existe para que um
   * erro de digitacao (um zero a mais) nao transforme a aplicacao em alvo de
   * exaustao de memoria - o arquivo e bufferizado antes de ir ao storage.
   */
  @Transform(({ value }: TransformInput): number =>
    isBlank(value) ? DEFAULT_DOCUMENT_MAX_FILE_SIZE : Number(value),
  )
  @IsInt({ message: 'DOCUMENT_MAX_FILE_SIZE deve ser um numero inteiro de bytes' })
  @Min(1, { message: 'DOCUMENT_MAX_FILE_SIZE deve ser maior que zero' })
  @Max(MAX_DOCUMENT_MAX_FILE_SIZE, {
    message: `DOCUMENT_MAX_FILE_SIZE nao pode passar de ${MAX_DOCUMENT_MAX_FILE_SIZE} bytes`,
  })
  DOCUMENT_MAX_FILE_SIZE: number = DEFAULT_DOCUMENT_MAX_FILE_SIZE;

  // ---------------------------------------------------------------------
  // Autenticacao servico-a-servico (n8n)
  // ---------------------------------------------------------------------

  /**
   * Caminho do arquivo de credenciais de servico (HASHES SHA-256, nunca o
   * token). Ver `modules/service-auth/`.
   *
   * Opcional, e AUSENTE significa recurso desligado: toda rota de servico
   * responde 401 e a aplicacao sobe normalmente. Por isso nao ha regra de
   * producao exigindo a variavel - quem nao usa o n8n nao precisa dela.
   *
   * Recebe um CAMINHO e nao o conteudo, ao contrario de `DATABASE_SSL_CA`, de
   * proposito: o arquivo precisa mudar SEM reiniciar o container (e assim que
   * uma credencial e revogada ou rotacionada), e variavel de ambiente so muda
   * reiniciando. O conteudo e relido a cada segundo.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  SERVICE_CREDENTIALS_FILE?: string;

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

  /**
   * Quem trata cada mensagem que o polling le: `direct` (padrao; o backend, como
   * sempre foi) ou `n8n` (o transporte assina um envelope e o entrega a um workflow
   * do n8n). Nao muda QUEM consome o bot - o polling e o mesmo nos dois modos.
   * `n8n` exige `TELEGRAM_N8N_WEBHOOK_URL` e `TELEGRAM_INGEST_SIGNING_KEY`.
   */
  @Transform(({ value }: TransformInput): unknown => (isBlank(value) ? 'direct' : value))
  @IsIn(TELEGRAM_DELIVERY_MODES, {
    message: "TELEGRAM_DELIVERY_MODE deve ser 'direct' ou 'n8n'",
  })
  TELEGRAM_DELIVERY_MODE: TelegramDeliveryMode = 'direct';

  /**
   * URL do webhook de producao do n8n que recebe os envelopes (ex.:
   * `http://n8n:5678/webhook/vastaflow-telegram`). So hosts da rede do Compose ou
   * loopback: o texto das mensagens vai para ela.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  TELEGRAM_N8N_WEBHOOK_URL?: string;

  /**
   * Chave de assinatura dos envelopes e das respostas (>= 32 caracteres
   * aleatorios). SEGREDO: so o backend a tem - nunca o n8n, o frontend ou o Git.
   * Sem ela a entrada `POST /service/telegram/ingest` recusa tudo.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  TELEGRAM_INGEST_SIGNING_KEY?: string;

  /**
   * SO PARA TESTE: aponta a Bot API para um servidor falso (`telegram-fake`,
   * `localhost`, `127.0.0.1`). Vazio = `api.telegram.org`. Lista fechada de hosts - o
   * token do bot vai na URL, entao um valor livre seria um desvio de segredo.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  TELEGRAM_API_BASE_URL?: string;

  /**
   * Quantas mensagens por minuto UM remetente pode enviar ao bot antes de ser
   * ignorado (limite por identidade; o excesso e descartado sem executar). Padrao 10.
   */
  @Transform(({ value }: TransformInput): number => (isBlank(value) ? 10 : Number(value)))
  @IsInt({ message: 'TELEGRAM_USER_RATE_LIMIT_PER_MINUTE deve ser um numero inteiro' })
  @Min(1)
  @Max(120)
  TELEGRAM_USER_RATE_LIMIT_PER_MINUTE: number = 10;

  /**
   * Retencao automatica de `telegram_inbound_events` (eventos terminais antigos). Opt-in: desligada
   * nao apaga nada (a limpeza manual por CLI continua valendo). Ver `telegram-events-retention.service.ts`.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "TELEGRAM_EVENTS_PURGE_ENABLED deve ser 'true' ou 'false'" })
  TELEGRAM_EVENTS_PURGE_ENABLED: boolean = false;

  /**
   * Dias de retencao dos eventos terminais (padrao 30). Piso de 7 (`EVENT_RETENTION_MIN_DAYS`): abaixo
   * disso um update reentregue seria tratado como novo.
   */
  @Transform(({ value }: TransformInput): number =>
    isBlank(value) ? EVENT_RETENTION_DEFAULT_DAYS : Number(value),
  )
  @IsInt({ message: 'TELEGRAM_EVENTS_RETENTION_DAYS deve ser um numero inteiro' })
  @Min(EVENT_RETENTION_MIN_DAYS)
  @Max(3650)
  TELEGRAM_EVENTS_RETENTION_DAYS: number = EVENT_RETENTION_DEFAULT_DAYS;

  /**
   * Integracao com a API externa do Plantae (somente leitura). Desligada por
   * padrao: sem `PLANTAE_ENABLED=true` nada e chamado e as demais variaveis sao
   * ignoradas em runtime. Ver `modules/integrations/plantae/`.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "PLANTAE_ENABLED deve ser 'true' ou 'false'" })
  PLANTAE_ENABLED: boolean = false;

  /**
   * Libera o comando `/contas_pagar` nos canais de mensageria (Telegram). Opt-in
   * SEPARADO de `PLANTAE_ENABLED`: ligar a integracao para o ADMIN consultar pela
   * API nao deve, sozinho, levar dado financeiro da cliente para uma conversa de
   * Telegram. Desligado por padrao. Mesmo ligado, exige a permissao `plantae:read`.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "PLANTAE_CHAT_COMMANDS_ENABLED deve ser 'true' ou 'false'" })
  PLANTAE_CHAT_COMMANDS_ENABLED: boolean = false;

  /**
   * Atestado do operador de que a ORGANIZACAO da chave do Plantae foi conferida com uma referencia
   * INDEPENDENTE (dado da cliente ou confirmacao formal do Plantae) - `GET /me` devolver 200 nao
   * prova isso. Padrao `false`. Sem ele, `/contas_pagar` nao consulta o Plantae e, ligado o comando
   * de chat com a integracao ativa, o boot e recusado. Ver `docs/integracao-plantae.md` (fase 6).
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "PLANTAE_ORGANIZATION_CONFIRMED deve ser 'true' ou 'false'" })
  PLANTAE_ORGANIZATION_CONFIRMED: boolean = false;

  /**
   * Mostra o nome (abreviado) do favorecido em `/contas_pagar`. Padrao `false`: o Telegram nao e
   * ponta a ponta e o projeto nao tem politica que autorize divulgar o favorecido por chat.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "PLANTAE_CHAT_SHOW_PAYEE_NAME deve ser 'true' ou 'false'" })
  PLANTAE_CHAT_SHOW_PAYEE_NAME: boolean = false;

  /**
   * WhatsApp (Cloud API OFICIAL da Meta). Desligado por padrao: com `false` as rotas do webhook
   * respondem 404 e nada e enviado. Ligado, exige TODAS as variaveis abaixo (o boot e recusado se
   * faltar alguma). Nenhuma e lida pelo n8n, pelo frontend ou pelo `migrate`.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "WHATSAPP_ENABLED deve ser 'true' ou 'false'" })
  WHATSAPP_ENABLED: boolean = false;

  /** Token que VOCE escolhe e informa no painel da Meta para a verificacao do webhook (GET). */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  WHATSAPP_WEBHOOK_TOKEN?: string;

  /** App Secret do app da Meta: assina cada POST do webhook (X-Hub-Signature-256). SEGREDO. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  WHATSAPP_APP_SECRET?: string;

  /** Token de acesso (usuario de sistema) para ENVIAR mensagens pela Graph API. SEGREDO. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  /** Id do numero de telefone na Meta (so digitos). Mensagens de outro numero sao ignoradas. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  /** Versao da Graph API (ex.: v21.0). Sem padrao no codigo: a versao e escolha de quem implanta. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  WHATSAPP_GRAPH_API_VERSION?: string;

  /**
   * Responder a quem NAO esta vinculado (e ao aviso de limite)? Padrao `false`: o bot fica em silencio com
   * desconhecidos (essencial se o numero tambem atende clientes). `/vincular <codigo>` sempre responde.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "WHATSAPP_REPLY_TO_UNLINKED deve ser 'true' ou 'false'" })
  WHATSAPP_REPLY_TO_UNLINKED: boolean = false;

  /** SO TESTE: servidor Graph falso (hosts whatsapp-fake, localhost, 127.0.0.1). Vazio = Meta. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  WHATSAPP_API_BASE_URL?: string;

  /**
   * NFS-e Nacional (Emissor Publico Nacional / Sefin Nacional). DESLIGADA por padrao: com `false`
   * os comandos /nfse* respondem "desligado" e nada e gerado, assinado ou enviado. Ligada, exige a
   * configuracao fiscal completa (sem padrao tributario) - ver `docs/nfse.md`. So o backend le estas
   * variaveis; o certificado digital nunca vai ao n8n, ao frontend, a log ou a auditoria.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "NFSE_ENABLED deve ser 'true' ou 'false'" })
  NFSE_ENABLED: boolean = false;

  /** `restrita` (homologacao) ou `producao`. Sem padrao. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_AMBIENTE?: string;

  /** SO TESTE: servidor falso (hosts nfse-fake, localhost, 127.0.0.1). Vazio = Sefin oficial do ambiente. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_API_BASE_URL?: string;

  /**
   * A troca de mensagens com a Sefin real so e liberada depois de o formato do corpo JSON ser validado
   * em producao restrita (o Swagger oficial exige certificado). Padrao `false`.
   */
  @Transform(({ value }: TransformInput): boolean => value === 'true' || value === true)
  @IsBoolean({ message: "NFSE_WIRE_CONTRACT_CONFIRMED deve ser 'true' ou 'false'" })
  NFSE_WIRE_CONTRACT_CONFIRMED: boolean = false;

  /** Caminho do certificado A1 (.pfx) DENTRO do conteiner do backend. Montado somente leitura; nunca no Git. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_CERT_PFX_PATH?: string;

  /** Senha do .pfx. SEGREDO. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_CERT_PFX_PASSWORD?: string;

  /** Opcional: cadeia de AC (PEM) para validar o servidor da Sefin, se o repositorio padrao nao a conhecer. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_CA_BUNDLE_PATH?: string;

  /** CNPJ do prestador (14 digitos). Deve ser o do certificado. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_PRESTADOR_CNPJ?: string;

  /** Inscricao municipal do prestador (opcional no leiaute; o municipio pode exigir). */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_PRESTADOR_IM?: string;

  /** Razao social do prestador (opcional no leiaute). */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_PRESTADOR_NOME?: string;

  /** Codigo IBGE (7 digitos) do municipio emissor (`cLocEmi`). */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_MUNICIPIO_EMISSOR_IBGE?: string;

  /** Situacao no Simples Nacional: 1 nao optante (NAO suportado: exige IBS/CBS), 2 MEI, 3 ME/EPP. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_OPCAO_SIMPLES?: string;

  /** Somente ME/EPP: 1, 2 ou 3 (regime de apuracao). Vazio = nao informar. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_REGIME_APURACAO_SN?: string;

  /** Regime especial de tributacao municipal: 0 (nenhum), 1 a 6 ou 9. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_REGIME_ESPECIAL_TRIBUTACAO?: string;

  /** Serie da DPS (1 a 49999 = aplicativo proprio). */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_DPS_SERIE?: string;

  /** Valor MAXIMO por emissao (ex.: 5000.00). Limite de negocio da cliente; sem padrao. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_VALOR_MAXIMO?: string;

  /** Validade do codigo de confirmacao (2 a 30). Padrao 10. */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_CONFIRMATION_TTL_MINUTES?: string;

  /**
   * Arquivo JSON dos PERFIS FISCAIS aprovados pela contadora (so empresa nao optante: NFSE_OPCAO_SIMPLES=1).
   * Fora do repositorio e montado somente leitura, como o certificado. Ver docs/nfse-perfis-fiscais.md.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_PERFIS_FISCAIS_PATH?: string;

  /**
   * AUTORIZACAO DE PRODUCAO da NFS-e: frase exata `EMITIR-NFSE-REAL-<CNPJ do prestador>`. Independente de
   * NFSE_WIRE_CONTRACT_CONFIRMED; exigida SO para emitir em producao real; deve ficar VAZIA (padrao) em qualquer
   * outro caso e nao pode existir na restrita. Ver docs/nfse-producao-restrita.md.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  NFSE_PRODUCAO_AUTORIZACAO?: string;

  /**
   * URL base da API. SO aceita o host de HOMOLOGACAO conhecido (`rc.plantae.agr.br`),
   * em HTTPS, no caminho `/api/v1/external`. Uma URL de producao so entra depois da
   * liberacao oficial da Plantae, por mudanca de codigo - ver `plantae.constants.ts`.
   * Se informada, e validada SEMPRE (mesmo com a integracao desligada): um valor
   * errado e erro de configuracao, nao algo a descobrir na primeira consulta.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  PLANTAE_BASE_URL?: string;

  /**
   * Chave de integracao da Plantae (Bearer). Segredo: fora do Git, so no backend,
   * nunca em frontend, n8n ou log. Ausente = `NOT_CONFIGURED`, sem derrubar nada.
   */
  @Transform(optionalString)
  @IsOptional()
  @IsString()
  PLANTAE_API_TOKEN?: string;

  /** Timeout de UMA requisicao ao Plantae, em ms (1000 a 60000; padrao 15000). */
  @Transform(({ value }: TransformInput): number | undefined =>
    isBlank(value) ? undefined : Number(value),
  )
  @IsOptional()
  @IsInt({ message: 'PLANTAE_TIMEOUT_MS deve ser um numero inteiro' })
  @Min(1000)
  @Max(60000)
  PLANTAE_TIMEOUT_MS?: number;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Host que o driver vai efetivamente receber, sem os colchetes do IPv6.
 *
 * `DATABASE_URL` tem precedencia sobre os campos separados (ver
 * `buildDataSourceOptions`), entao a regra de identidade precisa olhar para o
 * mesmo lugar que o driver. O `mysql2` extrai o host da URL com
 * `decodeURIComponent(new URL(url).hostname)` (`lib/connection_config.js`,
 * `parseUrl`) - o mesmo campo usado aqui, de proposito.
 *
 * Os colchetes PRECISAM ser removidos: para um esquema nao-especial como
 * `mysql:`, `URL.hostname` devolve o IPv6 entre colchetes (`[::1]`), e
 * `isIP('[::1]')` e 0 - o endereco passaria pela regra sem ser reconhecido.
 * Um teste pegou exatamente isso.
 *
 * URL malformada devolve `undefined`: e problema de outra natureza e falharia
 * na conexao com mensagem propria, nao cabe a esta regra opinar.
 */
function effectiveHost(env: EnvironmentVariables): string | undefined {
  const host = env.DATABASE_URL ? parseUrlHostname(env.DATABASE_URL) : env.DATABASE_HOST;

  return host?.replace(/^\[|\]$/g, '');
}

function parseUrlHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
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

  if (env.SWAGGER_ENABLED && env.NODE_ENV === Environment.Production) {
    problems.push(
      'SWAGGER_ENABLED=true e proibido em producao (a documentacao descreve toda a superficie da API)',
    );
  }

  const mysqlEmProducao =
    env.NODE_ENV === Environment.Production && env.DATABASE_TYPE === DatabaseType.Mysql;

  if (mysqlEmProducao && !env.DATABASE_SSL) {
    problems.push(
      'DATABASE_SSL=true e obrigatorio em producao com MySQL (a conexao sairia sem TLS)',
    );
  }

  // Ambiguidade e recusada em QUALQUER ambiente: nao ha precedencia entre as
  // duas formas, e quem configurasse as duas por engano nao saberia qual esta
  // em uso. Independe de `DATABASE_SSL`, porque a confusao na configuracao
  // existe mesmo com TLS desligado.
  if (env.DATABASE_SSL_CA && env.DATABASE_SSL_CA_FILE) {
    problems.push(
      'informe DATABASE_SSL_CA ou DATABASE_SSL_CA_FILE, nunca as duas (nao ha precedencia)',
    );
  }

  if (mysqlEmProducao && env.DATABASE_SSL && !env.DATABASE_SSL_CA && !env.DATABASE_SSL_CA_FILE) {
    problems.push(
      'em producao com MySQL e TLS, informe DATABASE_SSL_CA (conteudo PEM) ou DATABASE_SSL_CA_FILE (arquivo montado): sem a CA o certificado do servidor nao pode ser validado',
    );
  }

  // Com TLS ligado, o `mysql2` so confere a identidade do servidor quando o
  // host NAO e um literal de IP: ele passa `servername` ao TLS apenas nesse
  // caso, e sem `servername` a conferencia de hostname e saltada em silencio.
  // Um IP aqui devolveria exatamente o problema que `verifyIdentity: true`
  // existe para resolver, e de forma invisivel - dai ser recusado no boot.
  if (mysqlEmProducao && env.DATABASE_SSL) {
    const host = effectiveHost(env);
    if (host !== undefined && isIP(host) !== 0) {
      problems.push(
        'o host do banco em producao com TLS nao pode ser um endereco IP: use o nome do servico (o certificado do servidor precisa trazer esse nome no SAN, e o driver so confere a identidade quando o host e um nome)',
      );
    }
  }

  if (Boolean(env.SEED_ADMIN_EMAIL) !== Boolean(env.SEED_ADMIN_PASSWORD)) {
    problems.push('SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD devem ser informados juntos');
  }

  // A mensagem NUNCA repete o valor: a URL pode ter credencial e o token e segredo.
  if (env.PLANTAE_BASE_URL) {
    const base = parsePlantaeBaseUrl(env.PLANTAE_BASE_URL);
    if (!base.ok) {
      problems.push(`PLANTAE_BASE_URL invalida: ${base.problem}`);
    }
  }
  // Telegram via n8n. Mensagens fixas: nada do que foi informado e repetido.
  if (env.TELEGRAM_INGEST_SIGNING_KEY && !isAcceptableSigningKey(env.TELEGRAM_INGEST_SIGNING_KEY)) {
    problems.push(
      'TELEGRAM_INGEST_SIGNING_KEY invalida: use pelo menos 32 caracteres, sem espacos',
    );
  }
  // WhatsApp: ligado exige configuracao completa e plausivel (mensagens fixas, sem repetir valores).
  if (env.WHATSAPP_ENABLED) {
    const missing = [
      'WHATSAPP_WEBHOOK_TOKEN',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_GRAPH_API_VERSION',
    ].filter((key) => !env[key as keyof EnvironmentVariables]);
    if (missing.length > 0) {
      problems.push(`WHATSAPP_ENABLED=true exige: ${missing.join(', ')}`);
    }
  }
  for (const problem of validateWhatsappSettings(env)) {
    problems.push(problem);
  }
  // NFS-e: ligada exige a configuracao fiscal completa (so avalia quando NFSE_ENABLED=true).
  for (const problem of validateNfseSettings(env)) {
    problems.push(problem);
  }
  // Fail-closed da Fase 6: consulta financeira real pelo chat so com a organizacao confirmada.
  if (
    env.PLANTAE_ENABLED &&
    env.PLANTAE_CHAT_COMMANDS_ENABLED &&
    !env.PLANTAE_ORGANIZATION_CONFIRMED
  ) {
    problems.push(
      'PLANTAE_CHAT_COMMANDS_ENABLED com PLANTAE_ENABLED exige PLANTAE_ORGANIZATION_CONFIRMED=true ' +
        '(organizacao do Plantae conferida com referencia independente)',
    );
  }
  if (env.TELEGRAM_API_BASE_URL) {
    const base = resolveTelegramApiBase(env.TELEGRAM_API_BASE_URL);
    if (!base.ok) {
      problems.push(`TELEGRAM_API_BASE_URL invalida: ${base.problem}`);
    }
  }
  if (env.TELEGRAM_N8N_WEBHOOK_URL) {
    const webhook = parseN8nWebhookUrl(env.TELEGRAM_N8N_WEBHOOK_URL);
    if (!webhook.ok) {
      problems.push(`TELEGRAM_N8N_WEBHOOK_URL invalida: ${webhook.problem}`);
    }
  }
  if (env.TELEGRAM_DELIVERY_MODE === 'n8n') {
    if (!env.TELEGRAM_N8N_WEBHOOK_URL) {
      problems.push('TELEGRAM_DELIVERY_MODE=n8n exige TELEGRAM_N8N_WEBHOOK_URL');
    }
    if (!env.TELEGRAM_INGEST_SIGNING_KEY) {
      problems.push('TELEGRAM_DELIVERY_MODE=n8n exige TELEGRAM_INGEST_SIGNING_KEY');
    }
  }

  if (env.PLANTAE_API_TOKEN && !isPlausibleToken(env.PLANTAE_API_TOKEN)) {
    problems.push(
      'PLANTAE_API_TOKEN invalido: use de 8 a 512 caracteres ASCII imprimiveis, sem espacos',
    );
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
