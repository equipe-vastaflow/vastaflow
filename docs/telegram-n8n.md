# Telegram + n8n + Command Engine (Fase 5)

> **Estado: IMPLEMENTADO e validado localmente (Fase 5, 2026-10-13), com o n8n
> real em Docker e mensagens SIMULADAS.** **Nao** foi enviada nenhuma mensagem ao
> Telegram, **nenhum** bot real foi ativado e **nenhum** token de bot foi usado.
> Nao validado: o Telegram **real** (a Fase 5.1, secao 12, percorreu `getUpdates` -> relay -> `sendMessage`
> contra um Bot API **falso**), a VPS Linux, HTTPS publico e carga real.
>
> Decisao de origem: [`adr/0004-telegram-n8n-envelope-assinado.md`](adr/0004-telegram-n8n-envelope-assinado.md).
> Base: [`autenticacao-servico-a-servico.md`](autenticacao-servico-a-servico.md) (Fase 3)
> e o canal Telegram direto da Fase 2 ([`arquitetura.md`](arquitetura.md)).

## 1. O que existe

Um usuario autorizado envia um **comando** (`/ajuda`, `/status`, `/financeiro`,
`/contas_pagar`) por mensagem privada do Telegram e recebe a resposta no mesmo
chat. O n8n orquestra; **o NestJS decide** quem e a pessoa, o que ela pode fazer,
executa o comando e audita.

```
Telegram --getUpdates--> backend (UM consumidor)
                          | 1. reduz a mensagem a um ENVELOPE e o ASSINA (HMAC)
                          v
                         n8n  webhook /webhook/vastaflow-telegram
                          | 2. repassa envelope + assinatura
                          v      X-Service-Token (principal n8n-telegram)
                         backend  POST /service/telegram/ingest
                          | 3. confere assinatura/validade, reserva o update (banco)
                          | 4. identifica a PESSOA vinculada (external_identity_links)
                          | 5. RBAC dessa pessoa -> Command Engine -> auditoria
                          v
                         resposta ASSINADA  --> n8n --> backend (transporte)
                                                         6. confere a assinatura e
                                                            envia ao MESMO chat
```

Dois modos, escolhidos por `TELEGRAM_DELIVERY_MODE` (**um so consumidor**
`getUpdates` em qualquer modo):

| Modo | Quem avalia a mensagem | Padrao |
| --- | --- | --- |
| `direct` | o proprio backend (Fase 2) | **sim** |
| `n8n` | o backend, depois de passar pelo n8n (esta fase) | nao |

Tudo desligado por padrao: sem `TELEGRAM_BOT_TOKEN` e sem
`TELEGRAM_POLLING_ENABLED=true` nenhuma mensagem e lida.

## 2. Por que este desenho (resumo; detalhes no ADR 0004)

- O no **Telegram Trigger** do n8n 2.43.1 so recebe por **webhook** (`setWebhook`;
  verificado no codigo do no, na imagem em uso) e exige o **token do bot dentro do
  n8n**. O `getUpdates` e o webhook sao excludentes na Bot API, e o projeto exige
  que o n8n **nao** receba o token. Logo o backend continua lendo o Telegram.
- O backend **assina** o que entrega ao n8n. O n8n nao consegue forjar nem alterar
  quem fala, em qual chat ou o que disse - e nao consegue alterar a resposta.
- O n8n **nao envia a resposta** ao Telegram (isso exigiria o token): quem envia e
  o transporte do backend, depois de conferir a assinatura da resposta. E um desvio
  consciente do roteiro "o n8n responde" - registrado no ADR.

## 3. Envelope e resposta assinados

`telegram-envelope.ts`: HMAC-SHA256 sobre uma forma canonica (campos fixos, ordem
fixa, prefixo de dominio, **texto por hash**), com `TELEGRAM_INGEST_SIGNING_KEY`
(>= 32 caracteres; so o backend a conhece).

| Campo | Origem | Observacao |
| --- | --- | --- |
| `version`, `platform`, `chatType` | constantes (`v1`, `telegram`, `private`) | outro valor -> 400 |
| `botId` | prefixo numerico do token (nao e segredo) | parte da chave de idempotencia |
| `updateId`, `messageId` | Telegram | inteiros >= 0 |
| `chatId`, `userId` | Telegram | digitos; **chat = remetente** (so conversa privada) |
| `text` | Telegram | 1 a 4096 caracteres |
| `sentAt` (s), `issuedAt` (ms) | Telegram / transporte | validade: **5 min** (+ 60 s de tolerancia de relogio) |

**Nao existe campo** `role`, `permissions`, `actorUserId`, `usuarioId`, `isAdmin`:
o `ValidationPipe` global tem `forbidNonWhitelisted`, entao qualquer campo a mais
derruba a requisicao com **400** (provado em e2e e no n8n). A unica informacao de
identidade e o id do remetente **no Telegram**, protegido pela assinatura.

A resposta (`outcome`, `reply`) e assinada com **dominio diferente** e **amarrada
ao envelope** (bot, update, chat): uma resposta valida para um update nao serve
para outro, e a assinatura de um envelope nao vale como a de uma resposta.

## 4. Modelo de confianca (o que se prova e o que NAO)

**Garantias (testadas):**

| Ameaca | Mitigacao | Prova |
| --- | --- | --- |
| n8n se passa por outro usuario (troca `userId`/`chatId`) | assinatura cobre os dois | unit + e2e (403) |
| n8n envia `actorUserId`/`role`/`permissions` | DTO estrito | e2e (400) |
| n8n altera o texto para outro comando | texto na assinatura | unit + e2e (403) |
| n8n altera ou troca a resposta | assinatura da resposta, amarrada ao envelope | unit (relay) + simulador |
| n8n redireciona a resposta a outro chat | o destino e o chat do **proprio envelope** | unit |
| Replay de um envelope legitimo | validade de 5 min **e** indice unico no banco | unit + e2e + MySQL real |
| Duas entregas simultaneas do mesmo update | `INSERT` com indice unico; so uma passa | e2e + **MySQL real** (6 em paralelo -> 1 executa) |
| Credencial do n8n sem o escopo | `service:telegram:ingest` so no principal `n8n-telegram` | e2e (403) + n8n real |
| Chave de assinatura vazar via n8n | a chave **nao esta** no n8n (env do container verificado) | Docker |
| `/vincular CODIGO` passar pelo n8n | tratado no backend, antes do envelope; ingest recusa vinculo | unit + e2e |

**Riscos residuais (nao resolvidos, documentados):**

1. **Disponibilidade:** o n8n pode descartar ou atrasar mensagens. A assinatura
   garante integridade, nao entrega.
2. **Comprometimento do backend** (chave de assinatura, token do bot, credencial de
   servico) derruba tudo: nao ha defesa contra o proprio nucleo.
3. **Conta do Telegram tomada** (SIM swap, sessao roubada): quem a controla age
   como a pessoa vinculada. Mitigacao: revogar o vinculo
   (`DELETE /users/{id}/external-identities/{linkId}`; vale na proxima mensagem,
   o resolvedor relê o banco).
4. **Confidencialidade:** chats comuns do Telegram **nao** sao ponta a ponta; o
   texto e a resposta (que podem ter dado financeiro) ficam nos servidores deles.
   Por isso `/contas_pagar` e opt-in, tem permissao propria e e so de leitura.
5. **O texto da mensagem trafega pelo n8n** (rede interna, HTTP) e e **gravado transitoriamente** no
   PostgreSQL dele (secao 14): `EXECUTIONS_DATA_SAVE_*=none` NAO impede a gravacao inicial; o Compose
   reduz a janela para ~segundos. Quem administra o n8n tambem pode ler o trafego em memoria.
6. **Falsificar um evento do Telegram** exigiria o token do bot (so no backend); a
   assinatura **nao** protege o trecho Telegram -> backend (TLS da Bot API protege).
7. **At-most-once:** se o backend cair depois de reservar o update e antes de
   responder, a mensagem **nao e reexecutada**; a pessoa reenvia.

Nao se afirma "spoofing resolvido": o que se afirma e o que a tabela mostra.

## 5. Idempotencia persistente

Tabela `telegram_inbound_events` (migration `1791500000000-TelegramInboundEvents`,
MySQL **executada** em 8.4.9; Oracle **escrita e nao executada**):

- indice **unico** `(canal, bot_id, update_id)`; `update_id` em `decimal(20,0)`
  (o Oracle recusa `bigint` no TypeORM);
- status `PROCESSANDO | CONCLUIDO | FALHOU` e o desfecho tecnico; **sem texto, sem
  resposta, sem nome**; `created_at` indexado para retencao futura (nao ha rotina
  de limpeza ainda);
- a reserva e um `INSERT` antes de executar: duplicata -> `DUPLICATE`, nada executa,
  nada responde. Sobrevive a reinicio (provado) e a varias instancias.

## 6. Autorizacao: quem e o ator

O **servico nunca e o ator** e nao tem privilegio financeiro:

1. `n8n-telegram` so abre `POST /service/telegram/ingest` (escopo
   `service:telegram:ingest`); o principal `n8n` segue so com `service:identity`.
2. A pessoa vem de `external_identity_links` (usuario **ativo**, relido a cada
   mensagem). Sem vinculo -> `UNLINKED` e **nenhum comando roda** (inclusive
   `/contas_pagar`). Nao ha ADMIN padrao, nem vinculo automatico, nem por username.
3. O **RBAC e o do Command Engine existente**, aplicado a essa pessoa
   (`CommandRouter`). Nenhuma permissao existente foi alterada.
4. Auditoria `CHANNEL_MESSAGE` (uma linha por mensagem): `usuarioId` = **a pessoa**;
   `metadados` = `canal`, `resultado`, `autorizacao`, `comando` (so se registrado),
   `principal`, `servicoId`, `correlacao`, `updateId`. **Nunca** o texto, a resposta,
   o id do Telegram, token ou chave. Envelope recusado e auditado **sem** `usuarioId`.

Desfechos: `EXECUTED`, `DENIED`, `UNLINKED`, `UNKNOWN_COMMAND`, `FAILED`,
`DUPLICATE` (+ `UNAVAILABLE`, devolvido pelo workflow quando o backend nao responde).

## 7. Comandos

Reaproveitam o Command Engine; nenhum motor novo. Apenas texto, **chat privado**;
grupos, canais, anexos, edicoes, callbacks e encaminhadas sao ignorados. Sem
linguagem natural: so `/comando args`.

| Comando | Permissao | Observacao |
| --- | --- | --- |
| `/ajuda`, `/status` | nenhuma | listam so o que a pessoa pode usar |
| `/financeiro` | `finance:read` | financeiro **local** |
| `/contas_pagar` | **`plantae:read`** (so ADMIN) | Plantae, leitura, homologacao |
| `/vincular CODIGO` | - | so no caminho direto do backend |

### `/contas_pagar`

Contas a pagar **pendentes** (`status=0`, `tipo=despesa`) por vencimento.

- **Desligado por padrao**, com opt-in proprio: `PLANTAE_CHAT_COMMANDS_ENABLED=true`
  **e** `PLANTAE_ENABLED=true` **e** a permissao `plantae:read`. Cada camada
  desligada responde com frase fixa e **nao consulta**.
- Periodo: sem argumentos = hoje (fuso de Brasilia) ate +7 dias; ou
  `/contas_pagar AAAA-MM-DD AAAA-MM-DD` (ate 31 dias). Um pedido por vez, **uma
  pagina de 5 itens**; se ha mais, avisa e orienta a reduzir o periodo.
- Toda resposta comeca pelo aviso de **HOMOLOGACAO**. Cada linha: vencimento, valor **na moeda do titulo** (texto
  decimal exato, sem `float`, sem somar), parcela e referencia curta (`ref <parcela_id>`); o nome do favorecido so
  aparece com `PLANTAE_CHAT_SHOW_PAYEE_NAME=true` (padrao: oculto). So parcelas **pendentes** (filtro tambem no backend).
  **CPF/CNPJ, observacao, descricao, documento e rateio nunca saem.** Detalhes e procedimento: `docs/integracao-plantae.md`, secao 10.
- Falha do Plantae vira frase fixa; prazo de 20 s no chat. Reaproveita o
  `PlantaeService` (so GET, limitador de taxa, validacao de contrato).
- **Nenhuma chamada real ao Plantae foi feita nesta fase** (testes com `fetch`
  simulado; no Docker o Plantae esta desligado).
- Nova permissao `plantae:read`: concedida so ao ADMIN (todas as permissoes);
  `role-defaults` dos outros perfis **nao foi alterado**.

## 8. Configuracao

Variaveis (so o **backend** as recebe; o n8n nunca):

| Variavel | Padrao | Observacao |
| --- | --- | --- |
| `TELEGRAM_DELIVERY_MODE` | `direct` | `n8n` exige as duas abaixo |
| `TELEGRAM_N8N_WEBHOOK_URL` | vazio | so hosts `n8n`, `localhost`, `127.0.0.1`; `/webhook/...`; sem credencial/query |
| `TELEGRAM_INGEST_SIGNING_KEY` | vazio | >= 32 caracteres, sem espaco; **segredo** |
| `PLANTAE_CHAT_COMMANDS_ENABLED` | `false` | opt-in de `/contas_pagar` |
| `PLANTAE_ORGANIZATION_CONFIRMED` | `false` | atestado da organizacao; sem ele o comando nao consulta e o boot recusa ligar o comando com a integracao ativa |
| `PLANTAE_CHAT_SHOW_PAYEE_NAME` | `false` | mostrar o favorecido (abreviado) no chat |
| `TELEGRAM_USER_RATE_LIMIT_PER_MINUTE` | `10` | mensagens/min por remetente (1 a 120); ver 12.5 |
| `TELEGRAM_API_BASE_URL` | vazio | **so teste**: Bot API falso (hosts `telegram-fake`, `localhost`, `127.0.0.1`); vazio em ambiente real |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_POLLING_ENABLED` | vazio / `false` | inalterados |

A validacao de ambiente derruba o boot em combinacao invalida e **nunca repete o
valor** na mensagem. `.env.example` so tem placeholders.

n8n (Compose): `EXECUTIONS_DATA_SAVE_ON_SUCCESS/ERROR=none`,
`EXECUTIONS_DATA_SAVE_ON_PROGRESS=false`, `N8N_PAYLOAD_SIZE_MAX=1` (MiB).
Para depurar, mude **temporariamente** e limpe o historico depois.

## 9. Operacao

**Criar a credencial do n8n** (principal proprio, escopo minimo):

```bash
node dist/modules/service-auth/service-credential.cli.js create \
     --file infra/service-auth/credentials.json --id n8n-telegram-2026-10 --principal n8n-telegram
```

O token sai **uma vez** no stdout. No n8n: credencial **Header Auth**, nome do
cabecalho `X-Service-Token`, valor = o token. Detalhes e rotacao:
[`autenticacao-servico-a-servico.md`](autenticacao-servico-a-servico.md).

**Importar o workflow** (`integrations/telegram/n8n/`): ver o
[README da pasta](../integrations/telegram/n8n/README.md). O arquivo versionado nao
tem credencial, ID de credencial, `webhookId`, URL externa nem dado real.

**Simular sem Telegram** (dentro do container do backend, que tem a chave e a URL):

```bash
docker compose exec backend node dist/modules/integrations/telegram/telegram-simulate.cli.js \
    --user 123456789 --text "/ajuda"            # --update-id N repete um update; --dry-run nao envia
```

O simulador monta o envelope, assina, chama o webhook do n8n e **confere a assinatura
da resposta**. Usa um bot ficticio (`999000111`) para nunca colidir com updates de um
bot real. Nao fala com o Telegram. (No Git Bash do Windows, defina
`MSYS_NO_PATHCONV=1`, ou `/ajuda` vira um caminho.)

**Ligar de verdade (NAO feito; precisa de autorizacao separada):** token do bot no
`.env` **do servidor** (nunca em chat/ticket), `TELEGRAM_DELIVERY_MODE=n8n`,
URL e chave preenchidas, `TELEGRAM_POLLING_ENABLED=true`, workflow **ativo**. Um unico
ambiente por bot.

## 10. O que foi provado e como

- **Testes automatizados** (backend): unitarios do envelope, configuracao, mapper,
  cliente n8n, relay, ingestao, repositorio (SQLite), adaptador, `/contas_pagar`,
  simulador, arquitetura e **o proprio JSON do workflow**; e2e
  `telegram-ingest.e2e-spec.ts` (aplicacao completa). Numeros no relatorio da fase.
- **Testes de mutacao** (19 defeitos de seguranca introduzidos de proposito; todos
  derrubaram algum teste): assinatura ignorada, expiracao ignorada, chat != remetente,
  vinculo aceito no ingest, duplicata sem tratamento, resposta sem conferencia,
  `/vincular` indo ao n8n, destino da resposta, texto fora da assinatura, redirect,
  host externo, campo `actorUserId`, rota sem escopo, escopo no principal errado,
  permissao e opt-in de `/contas_pagar`, CPF/CNPJ na resposta, ingest sem assinatura (e2e),
  sem idempotencia (e2e).
- **Docker real** (MySQL 8.4.9 com TLS, n8n 2.43.1): migration aplicada sobre um banco
  existente; trava `PendingMigrationsCheck` impediu o boot antes dela; workflow importado e
  ativado; `/ajuda`, `/status`, `/financeiro` (ADMIN), `/financeiro` negado (OPERADOR),
  nao vinculado, `/contas_pagar` com chat desligado, duplicado, chave errada, workflow
  desativado, credencial de escopo errado e credencial desconhecida; idempotencia apos
  **reiniciar o backend** e com **6 entregas simultaneas** (1 executou); n8n sem
  nenhuma variavel de Telegram/Plantae/chave, **sem rota ao MySQL**, **sem execucoes
  gravadas**; `/api/service/telegram/ingest` -> 404 na borda; so 127.0.0.1 publicado.
- **Auditoria e logs:** nenhuma linha continha o texto sentinela, o id do Telegram, a
  chave nem o token (com controle positivo de que os logs tinham conteudo).

## 11. Limitacoes e pendencias

- **Nao testado com o Telegram real**: `getUpdates`, `sendMessage` e o relay de ponta a ponta foram
  exercidos contra um Bot API **falso** (secao 12), nunca contra o servico real.
- **Oracle:** migration escrita e **nunca executada**; nao se afirma que funciona.
- `/contas_pagar` **nunca consultou o Plantae de verdade** nesta fase.
- Retencao de `telegram_inbound_events` e **manual** (CLI; secao 12.4); nao ha agendador interno.
- Sem TLS entre backend e n8n (HTTP na rede interna do Compose).
- Rate limit por remetente existe desde a 5.1 (secao 12.5), em memoria do processo.
- Um evento ficar em `PROCESSANDO` (queda no meio) nao e reaproveitado: regra
  at-most-once; ha CLI para identificar e encerrar (secao 12.4).
- O workflow responde `{"outcome":"UNAVAILABLE"}` (HTTP 200) quando o backend nao
  devolve 200; o transporte entao envia um aviso fixo ao usuario.
- Reaproveitar este fluxo para WhatsApp (Fase futura) exigira novo envelope
  (`platform`) e novo escopo; **nada** de WhatsApp/Meta foi configurado.

## 12. Fase 5.1 - validacao do transporte (Bot API FALSO, sem Telegram real)

> Executada em 2026-10-13. **Nenhuma conexao com `api.telegram.org`**, nenhum token real,
> nenhuma mensagem a usuario real, Plantae desligado. Tudo abaixo usa ids, textos e tokens
> **ficticios**.

### 12.1 O que o n8n verifica (e o que NAO)

O workflow tem uma decisao "Tem envelope e assinatura?". Ela e **estrutural**: confere que o corpo
traz um objeto `envelope` e um texto `signature` - **nada alem disso**. O n8n **nao tem a chave** de
assinatura e **nao verifica nada criptograficamente**, e nao deve: se a verificasse, a chave estaria
nele, e o objetivo do desenho e que um n8n comprometido nao tenha como forjar nem alterar nada.

| Fronteira | Quem tem a chave | O que verifica |
| --- | --- | --- |
| transporte do backend (relay) | **sim** | **assina** o envelope; **verifica** a assinatura da resposta e envia ao chat do PROPRIO envelope |
| n8n | **nao** | so a forma (objeto + texto); repassa. Nenhuma garantia criptografica |
| ingestao do backend | **sim** | **verifica** assinatura (tempo constante, hex estrito), validade do envelope (5 min), idade da mensagem (10 min), chat = remetente; **assina** a resposta |

Toda a autoridade criptografica fica nas duas pontas confiaveis (ambas no backend). Qualquer texto
anterior que sugira que "o n8n valida a assinatura" deve ser lido como a decisao estrutural acima.

### 12.2 Auditoria tecnica da assinatura (o que foi conferido no codigo)

- **Algoritmo:** HMAC-SHA256, hex minusculo de 64 caracteres. Chave >= 32 caracteres, so no backend.
- **Canonicalizacao:** campos fixos em ordem fixa, separados por `\n`, com prefixo de dominio
  (`vastaflow.telegram.envelope.v1` / `...reply.v1`). Os campos estruturais sao digitos ou constantes
  (validados no DTO); o unico campo livre, o **texto, entra por hash** - nao ha como forjar outro campo
  por separador. Nenhum campo do envelope fica fora da assinatura (teste varre campo a campo).
- **Comparacao:** `timingSafeEqual` sobre 32 bytes. **Defeito corrigido nesta fase:** `Buffer.from(x,'hex')`
  PARA no primeiro caractere invalido, entao uma assinatura valida **seguida de lixo** seria aceita no
  lado da resposta (o DTO ja barrava no ingest). Agora `^[0-9a-f]{64}$` e exigido antes de comparar.
- **Validade:** envelope 5 min (+60 s de relogio adiantado) **e** mensagem 10 min (`message.date`).
- **Replay:** indice unico `(canal, bot, update)`. A janela de 5 min nao basta sozinha: um update
  antigo reentregue pelo Telegram ganha um envelope novo - por isso a idade da MENSAGEM tambem e checada.
- **Resposta x requisicao:** assinada com dominio proprio e amarrada a `bot`, `update`, `chat`, `outcome` e
  hash do texto. Resposta de outro update, de outro chat, com outro desfecho ou texto alterado: recusada
  (unitario + Docker real).
- **Destino:** o relay envia ao `chat.id` do **update original** (o proprio Telegram), nunca a um campo
  vindo do n8n. Verificado com n8n adulterado (secao 12.5).

### 12.3 Entrega: o compromisso, dito sem rodeio

O sistema oferece **no maximo uma execucao** por mensagem (*at-most-once*). **Nao** oferece entrega
exatamente-uma-vez, **nem** entrega garantida. As duas coisas se excluem sem uma transacao que englobe o
Telegram, o n8n e o banco; escolheu-se **nao duplicar efeito**, porque um comando futuro pode ter efeito
colateral. Consequencias aceitas e documentadas:

| Situacao | O que acontece | O que o usuario ve |
| --- | --- | --- |
| backend cai depois de reservar e antes de responder | evento fica `PROCESSANDO`; **nunca reexecuta** | nada (ou o aviso fixo, se o relay sobreviveu) - reenvia |
| n8n fora do ar / workflow inativo / credencial errada | nada executa | aviso fixo "nao conseguiu processar" |
| `sendMessage` falha depois de executar | executou e **nao** reenvia | nada - reenvia (vai dar `DUPLICATE` se for o mesmo update; um novo comando e outro update) |
| reentrega do mesmo update (reinicio) | `DUPLICATE`: nao executa, nao responde | nada de novo |
| mensagem com mais de 10 min (queda longa) | **descartada**, sem executar e sem responder | nada - reenvia |

### 12.4 Eventos presos, estados terminais e retencao

Estados em `telegram_inbound_events`: `PROCESSANDO` -> `CONCLUIDO` | `FALHOU`, e o terminal **explicito**
`ABANDONADO` (decisao de um operador sobre um evento preso). Sem migration: a coluna `status` (varchar 20)
comporta o novo valor.

- **Preso** = `PROCESSANDO` ha mais de **15 min** (os prazos do fluxo somam menos de 1 min).
- **Observabilidade:** no boot, o backend registra `N evento(s) preso(s) em PROCESSANDO` (so o numero).
- **Consulta tecnica** (sem rota HTTP, sem conteudo):
  `node dist/modules/integrations/telegram-ingest/telegram-events.cli.js report`
  (contagem por status + lista dos presos: id, `update_id`, idade).
- **Intervencao manual**, sempre sem reexecutar:
  1. `report` e identifique o preso; confira no log/auditoria (`CHANNEL_MESSAGE`) se o comando chegou a executar;
  2. se o usuario precisa do resultado, **ele reenvia o comando** (e um update novo, outro `update_id`);
  3. `... telegram-events.cli.js abandon --id <uuid>` encerra o evento como `ABANDONADO`. A reserva
     **permanece**: o update antigo continua `DUPLICATE`, nunca roda. Recusa evento que nao esteja preso;
  4. a intervencao grava `TELEGRAM_EVENT_ADMIN` na auditoria (sem conteudo).
- **Retencao:** `... telegram-events.cli.js purge --older-than-days <n>` apaga **so terminais**
  (`CONCLUIDO`, `FALHOU`, `ABANDONADO`) com mais de `n` dias; **piso de 7 dias**, abaixo disso o CLI
  recusa; sem `--yes` so simula; nunca apaga `PROCESSANDO`. O piso existe porque apagar o registro
  reabre o update: o Telegram reentrega por ate 24 h e o fluxo ja descarta mensagem com mais de 10 min
  (no polling **e** no ingest), entao 7 dias cobre com folga qualquer update atrasado. Recomendado:
  30 dias, rodando o CLI por agendamento do servidor (nao ha job interno).
- Linhas de auditoria **antigas** (anteriores a 5.1) de `/contas_pagar` podem ter o id da conversa do
  Telegram em `metadados.conversationId`; a auditoria e append-only e nao foi reescrita.

### 12.5 Rate limit por remetente

- **Onde:** no polling (unico consumidor), **antes** de qualquer n8n/banco/Plantae, nos dois modos.
  Janela deslizante de 60 s por **id do remetente**; padrao **10/min**
  (`TELEGRAM_USER_RATE_LIMIT_PER_MINUTE`, 1 a 120).
- **Comportamento:** o excesso e **descartado em O(1)** - nao entra em fila (nao ha fila a crescer),
  nao consome n8n, banco nem Plantae. Um aviso fixo e enviado **uma vez** por janela.
  O descarte nao consome o RBAC: e anterior a ele e nao o substitui.
- **Isolamento:** a chave e o remetente; ninguem esgota a cota de outro. O mapa e limitado
  (10.000 chaves, despejo das janelas vencidas e depois das mais antigas): uma enxurrada de ids falsos
  nao faz a memoria crescer.
- **`/contas_pagar`:** alem disso, **3 consultas/min por pessoa** antes de chamar o Plantae.
- **Varias instancias:** o estado e **do processo**. O transporte tem um unico consumidor por bot,
  entao o limite vale integralmente; para `/contas_pagar`, N instancias permitem ate N x 3/min por pessoa
  (melhor esforco; o limitador de taxa do Plantae segue valendo por instancia).
- **Limite conhecido:** o laco processa em sequencia; uma consulta lenta ao Plantae (ate 20 s) atrasa as
  mensagens seguintes de todos. O limite por pessoa reduz, nao elimina.
- Mensagens **encaminhadas** e `via_bot` sao ignoradas sem consumir cota.

### 12.6 Bot API falso (`backend/test/fake-telegram/`)

- `fake-bot-api.js` (so `node:http`, sem dependencia): `getMe`, `getUpdates` (offset que confirma,
  long polling, **409 em getUpdates concorrente**, como no Telegram) e `sendMessage`; mais controle em
  `/__control/*` (`enqueue`, `sent`, `state`, `redeliver`, `reset`). Nao registra corpo de mensagem em log.
- `docker-compose.fake-telegram.yml`: acrescenta o servico `telegram-fake` (rede `automation`, **sem porta
  publicada**, somente leitura, sem capacidades) e faz o backend depender dele.
- **Apontar o backend para o falso:** `TELEGRAM_API_BASE_URL=http://telegram-fake:8081`. Lista fechada de
  hosts (`telegram-fake`, `localhost`, `127.0.0.1`), so `http`, sem credencial/caminho: **nunca** aceita um
  host externo - a URL da Bot API carrega o token, entao um valor livre seria desvio de segredo. Qualquer
  outro valor derruba o boot (a mensagem nao repete o valor). Em ambiente real fica **vazio**.
- O codigo de transporte e o REAL (o cliente so le a base de configuracao); nada foi substituido.
- `telegram-transport.e2e-spec.ts` roda a cadeia inteira em processo (polling real, relay real, "n8n" HTTP
  falso com modos maliciosos, ingestao real); `fake-telegram.e2e-spec.ts` prova o contrato do falso com o
  `TelegramApiClient` real.

### 12.7 Cenarios validados (Docker real: polling -> n8n 2.43.1 -> ingestao -> sendMessage no falso)

| | Cenario | Resultado |
| --- | --- | --- |
| A | vinculado e autorizado: `/ajuda` | resposta no **mesmo** chat, em nenhum outro |
| B | nao vinculado | resposta segura, sem financeiro |
| C | sem permissao | `/financeiro` negado |
| D | mensagem duplicada, **apos reiniciar o backend** | nao executa, nao responde, log `entrega duplicada` |
| E | 3 atualizacoes simultaneas | cada uma no proprio chat |
| F | n8n **parado** | aviso fixo, nada executado |
| G | backend reiniciado | `conflicts = 0` no falso: um unico consumidor |
| H | n8n altera o texto da resposta | texto adulterado **nunca** enviado; aviso fixo |
| I | n8n troca remetente/chat (se passa por outro) | rejeitado; so o chat de origem recebe o aviso; o outro nada |
| J | encaminhada / `via_bot` | ignoradas |
| K | Plantae desabilitado, comando de chat ligado | "desativada"; nenhum dado financeiro; **nenhuma conexao de saida 443** |
| L | credencial de servico de escopo errado | acesso negado; aviso fixo |
| - | mensagem de 20 min | descartada |
| - | 13 mensagens de um remetente | 10 atendidas + 1 aviso; outro usuario normal |

Mais: eventos presos / `abandon` / `purge` no **MySQL real**, migration em banco **vazio** (9 migrations) e
sobre banco existente, e varredura de logs (backend, n8n, PostgreSQL, Nginx, migrate), auditoria e API de
execucoes do n8n com texto sentinela, id do Telegram, token do bot, chave e tokens de servico: **nada**.
A trilha administrativa de VINCULO (`EXTERNAL_IDENTITY_*`) guarda o id externo **de proposito**.

### 12.8 Procedimento futuro com bot REAL (documentado, NAO executado)

Precisa de autorizacao explicita e separada. Em um ambiente de homologacao, uma conta de teste:

1. Criar o bot no @BotFather **em outra conversa**; o token vai direto ao `.env` do servidor
   (nunca em chat, ticket ou Git). Confirmar `TELEGRAM_API_BASE_URL` **vazio**.
2. Gerar `TELEGRAM_INGEST_SIGNING_KEY` (>= 32 aleatorios), credencial `n8n-telegram`, importar e ativar o workflow.
3. `TELEGRAM_DELIVERY_MODE=n8n`, `TELEGRAM_POLLING_ENABLED=true` em **um unico** ambiente por bot.
4. Vincular **uma** conta de teste pelo fluxo administrativo; testar `/ajuda`, nao vinculado, negado, duplicado.
5. So depois, e com decisao propria, `PLANTAE_CHAT_COMMANDS_ENABLED`.
6. Primeiro dia: acompanhar o log (`evento(s) preso(s)`), conferir a auditoria, agendar `purge`.
7. Reversao: `TELEGRAM_POLLING_ENABLED=false` e reiniciar; desativar o workflow; revogar a credencial.

### 12.9 Riscos conhecidos e limitacoes que permanecem

- Nada disto foi exercido contra o Telegram real; a Bot API real pode ter comportamento fora do que o falso
  copia (limites de taxa, erros 429, formatos raros). O falso nao e uma prova de conformidade.
- At-most-once: mensagens podem se perder sem retentativa (secao 12.3).
- Sem TLS entre backend e n8n; o texto passa pelo n8n.
- Rate limit por processo; laco sequencial (uma consulta lenta atrasa todos).
- `PROCESSANDO` preso exige intervencao humana (CLI); nao ha recuperacao automatica por desenho.
- Sem agendador interno de retencao; Oracle nao executado; `/contas_pagar` nunca consultou o Plantae real.

## 13. Fase 5.2 - ativacao do bot REAL (@VastaOficialBot), ambiente local

> Executada em 2026-10-14, **somente em ambiente local**, com uma conta de teste, comandos
> inofensivos, Plantae desligado e nenhuma operacao financeira real. Nenhum segredo e documentado.

### 13.1 Procedimento que foi seguido (reutilizavel)

1. **Token:** o token inicial do BotFather foi revogado e substituido; o novo foi colado **pela pessoa**
   no `.env` local (gitignored). Ele nunca passa por chat, argumento de linha de comando ou Git.
2. **`.env`:** segredos aleatorios (bancos, JWT, n8n, chave HMAC) gerados sem imprimir; `TELEGRAM_BOT_TOKEN`
   preenchido a mao; `TELEGRAM_API_BASE_URL` **vazio** (API oficial); `PLANTAE_ENABLED=false` e
   `PLANTAE_CHAT_COMMANDS_ENABLED=false`; `TELEGRAM_POLLING_ENABLED=false` ate a autorizacao final.
3. **Stack:** TLS local (`scripts/gerar-tls-dev.sh`), `docker compose build backend migrate`, `up -d backend n8n`
   (sem Nginx: nada de porta publica; so o editor do n8n em `127.0.0.1`). O primeiro boot do MySQL pode passar
   do prazo do healthcheck; basta subir de novo.
4. **Credencial de servico** pelo CLI oficial (principal `n8n-telegram`; o principal `n8n` nao e reutilizado); o
   token foi para o cofre do n8n e o arquivo temporario foi apagado.
5. **n8n:** dono local, credencial Header Auth, importacao e ativacao do workflow versionado.
6. **Diagnostico unico:** `getMe` (conferir `@VastaOficialBot`) e `getWebhookInfo` (conferir que NAO ha webhook).
   Com webhook ou outro consumidor, **parar**: nao se executa `deleteWebhook`/`setWebhook` sem autorizacao.
7. **Usuario de teste e vinculo** pelo CLI local (13.2), sem ADMIN.
8. **Ativacao:** `TELEGRAM_POLLING_ENABLED=true`, recriar **so o backend**, conferir `polling iniciado`.
9. A pessoa enviou `/start`, gerou o codigo no proprio terminal, enviou `/vincular <codigo>` ao bot e testou
   `/ajuda`, `/status` e `/financeiro`.

### 13.2 CLI local de preparacao (`local-operator.cli.js`)

```bash
docker compose -f docker-compose.production.yml exec backend \
  node dist/modules/external-identities/local-operator.cli.js create-operator
docker compose -f docker-compose.production.yml exec backend \
  node dist/modules/external-identities/local-operator.cli.js link-code --email <email>
```

- Para quem tem acesso ao **servidor** (mesmo nivel de quem le o `.env`). Exige terminal interativo; e-mail, nome e
  senha sao digitados no prompt (senha sem eco). Nada de senha por argumento, variavel de ambiente ou pipe.
- O perfil criado e **sempre OPERADOR**; nao ha opcao de perfil, e `link-code` recusa ADMIN, usuario inativo e
  inexistente. O codigo (15 min, uso unico) aparece **uma vez**, so no terminal; so o hash vai ao banco.
- **Nao sobe a aplicacao Nest** (nada de segundo polling).
- Auditoria `USER_CREATED` / `IDENTITY_LINK_REQUESTED` com `origem: cli-local`, **sem ator** (`usuarioId` nulo; o
  usuario atingido em `alvoId`). A solicitacao de vinculo registra o proprio alvo como autor: e um procedimento de
  quem opera o servidor, nao uma acao de um usuario da aplicacao.
- Limites: nao e um fluxo de producao com ADMIN (para isso existem as rotas administrativas); a captura de senha em
  modo raw nao trata teclas de edicao alem de apagar.

### 13.3 O que foi observado com o bot real

| Comando | Resultado | Registro |
| --- | --- | --- |
| `/start` (antes do vinculo) | "conta nao vinculada" | `UNLINKED`, sem usuario |
| `/vincular <codigo>` | vinculo criado | tratado no backend, **nunca no n8n** (sem evento no n8n) |
| `/start` (depois) | comando desconhecido (`/start` nao existe no Command Engine) | `UNKNOWN_COMMAND`, com usuario |
| `/ajuda`, `/status` | resposta correta no mesmo chat | `EXECUTED / AUTORIZADO` |
| `/financeiro` (OPERADOR) | acesso negado | `DENIED / NEGADO` |

Evidencias internas (auditoria somente de leitura): 8 updates reais na tabela de idempotencia, todos `CONCLUIDO`, sem
duplicatas; `principal = n8n-telegram` em todas as linhas; usuario = o OPERADOR; o contador do workflow no n8n bate
com as execucoes (8 reais + testes); zero avisos de falha de entrega, assinatura ou envio; zero consultas ao Plantae;
nenhum token, chave, codigo de vinculo ou id do Telegram nos logs de backend, n8n, PostgreSQL, MySQL e migrate.
Nao exercitado com o bot real: reentrega duplicada (provada na 5.1 com o servidor falso).

### 13.4 Rollback

`TELEGRAM_POLLING_ENABLED=false` no `.env` e `docker compose up -d --no-deps backend` (para o consumo). Opcional:
desativar o workflow e revogar a credencial (`service-credential.cli.js revoke`). Nada disto apaga volumes ou dados.

## 14. Fase 5.3 - privacidade do n8n: o que ele REALMENTE grava

### 14.1 O achado (Fase 5.2)

Com `EXECUTIONS_DATA_SAVE_*=none`, a API do n8n mostrava **zero** execucoes, mas o PostgreSQL do n8n tinha linhas em
`execution_entity` (status `running`, com `deletedAt` preenchido) e payloads em `execution_data` contendo o **texto do
comando, os ids do Telegram e o envelope assinado** do trafego real. Nao havia resposta do backend nem token de servico
nos payloads. As afirmacoes anteriores deste projeto de que "o n8n nao guarda o conteudo das execucoes" estavam
**imprecisas** e foram corrigidas.

### 14.2 Como o n8n 2.43.1 funciona (lido do codigo da imagem em uso)

| Peca | Comportamento |
| --- | --- |
| Criacao | A execucao do webhook e **gravada ao iniciar**, com o corpo recebido em `execution_data`, independentemente de `SAVE_ON_SUCCESS`. |
| Fim | Se o resultado nao deve ser salvo, o n8n **nao apaga** a linha: faz **soft-delete** (`deletedAt`). O status continua `running`. |
| Hard-delete | Um job do lider apaga fisicamente as linhas com `deletedAt <= agora - EXECUTIONS_DATA_HARD_DELETE_BUFFER` (padrao **1 h**), a cada `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL` (padrao **15 min**). Janela padrao: **ate ~1 h 15 min**. |
| Tabelas com payload | `execution_data` (corpo/payload, verificado: contem comando, ids e envelope) e `execution_entity` (metadados da execucao). |
| Poda por idade/contagem | `EXECUTIONS_DATA_MAX_AGE` (336 h) e `EXECUTIONS_DATA_PRUNE_MAX_COUNT` (10000): pouco relevantes aqui: a linha e soft-deleted ao terminar a execucao. |

### 14.3 Correcao aplicada (minimizacao, nao eliminacao)

No Compose do n8n: `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0` e `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=1`. **Medido** no
Docker real: uma mensagem com texto sentinela ficava gravada logo apos a execucao e foi **removida fisicamente em ~25 s**
(antes: ate ~1 h 15 min); as 4 linhas reais antigas foram removidas pelo proprio pruner do n8n. Nenhum `DELETE` manual foi
feito. `backend/src/n8n-privacy.compose.spec.ts` trava essas configuracoes (e a mutacao que volta o buffer para 1 h derruba o teste).

### 14.4 O que continua verdadeiro (limitacoes honestas)

- O n8n **ainda grava** o texto do comando, os ids e o envelope **por alguns segundos**, no PostgreSQL interno
  (sem porta publicada, fora das redes do nucleo). Nao ha configuracao do n8n que evite a gravacao inicial.
- Depois do `DELETE`, os bytes podem permanecer em paginas do PostgreSQL (tuplas mortas, WAL) ate o autovacuum/reciclagem, e
  em **backups do volume** feitos nessa janela. Backup do volume do n8n deve ser tratado como dado pessoal.
- Quem administra o n8n pode ler o trafego em memoria e, durante a janela, o banco.
- Reducao real exigiria que o texto nao passasse pelo n8n (ex.: o n8n receber so referencias) - uma mudanca de desenho,
  nao feita nesta fase.
- Os logs do n8n e do backend nao registram texto, ids, chave ou tokens (verificado com sentinela).
- Em ambientes com muitos eventos, a varredura de 1 min adiciona carga leve ao PostgreSQL do n8n.
- O n8n registra, no boot, falha de conexao do *task runner* de Code nodes; o workflow nao usa Code nodes e o aviso nao afeta o fluxo.
