import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Quantos proxies confiaveis existem entre a internet e a aplicacao.
 *
 * `1` corresponde a topologia de producao prevista: um unico proxy reverso
 * (Nginx) na frente do Node. Com isto o Express passa a ler o ULTIMO endereco
 * de `X-Forwarded-For` como `request.ip`, que e o que o proxy adiciona - e e o
 * que a trilha de auditoria precisa registrar.
 *
 * Deliberadamente um numero, e nao `true`. Com `true` o Express confiaria na
 * cadeia inteira de `X-Forwarded-For`, e qualquer cliente poderia inventar o
 * proprio IP escrevendo o header - exatamente o que se quer evitar num campo
 * que vai para a auditoria.
 *
 * Esta configuracao pressupoe que a aplicacao NUNCA recebe conexao direta da
 * internet. Se um dia o processo for exposto sem proxy na frente, este valor
 * tem de voltar a zero, senao o IP auditado passa a ser falsificavel.
 */
const TRUSTED_PROXY_HOPS = 1;

/**
 * Tamanho maximo de um corpo de requisicao.
 *
 * Igual ao default do Express, agora explicito: as rotas atuais trocam JSON
 * pequeno (o maior campo do sistema tem 500 caracteres), entao 100 kB ja e
 * folgado. Explicitar protege de uma mudanca de default do framework e deixa o
 * limite visivel para quem opera.
 *
 * NAO e o limite de upload de documento: quando a fundacao de arquivos existir,
 * ela tera regra propria, provavelmente por rota, e este valor global nao deve
 * ser aumentado para acomoda-la.
 */
const MAX_REQUEST_BODY = '100kb';

/**
 * Configuracao HTTP compartilhada entre `main.ts` e os testes e2e, para que os
 * testes exercitem exatamente o pipeline de producao.
 */
export function configureApp(app: NestExpressApplication): void {
  // Resolve `request.ip` atras do proxy reverso. Sem isto, todo registro de
  // auditoria gravaria o IP do proprio proxy.
  app.set('trust proxy', TRUSTED_PROXY_HOPS);

  // Limite explicito de corpo, antes de qualquer validacao: um payload grande e
  // recusado sem ser desserializado.
  // O corpo BRUTO (necessario a assinatura do webhook do WhatsApp) vem de `rawBody: true` na criacao
  // da aplicacao (`main.ts` e `test/support/test-app.ts`), que o Nest preserva neste parser.
  app.useBodyParser('json', { limit: MAX_REQUEST_BODY });
  app.useBodyParser('urlencoded', { limit: MAX_REQUEST_BODY, extended: true });

  // Valida e transforma todo payload de entrada. `forbidNonWhitelisted`
  // rejeita campos nao declarados no DTO, em vez de ignora-los em silencio.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
