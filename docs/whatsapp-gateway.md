# WhatsApp Gateway (Baileys) - etapas 2 e 3

> **Estado: o gateway e o armazenamento cifrado da sessao existem e estao TESTADOS com socket e banco FALSOS. Nenhuma conta
> foi conectada, nenhum QR Code foi gerado, nenhuma mensagem real foi enviada ou recebida, o servico NAO esta no Compose
> de producao e `WHATSAPP_ENABLED` continua `false`.** A conexao com o WhatsApp tem um interruptor proprio
> (`GATEWAY_CONNECT_ENABLED`, desligado por padrao): sem ele o processo apenas VERIFICA configuracao, chave e banco e sai.
> **A persistencia, a trava de instancia unica e a recuperacao NAO foram comprovadas contra um MySQL real nem em Docker**
> (secao 7.9).
>
> Decisao e arquitetura: auditoria de 2026-11-04 (gateway separado, sem n8n no caminho, backend como unico cerebro).
> Lado do backend (etapa 1): [`whatsapp.md`](whatsapp.md), secao 1.1.

## 1. O que e

Um servico Node.js **separado** (`whatsapp-gateway/`, ESM + TypeScript, independente do NestJS) cuja unica funcao e
**transportar**: conectar-se ao WhatsApp pelo Baileys, entregar cada mensagem de texto valida ao backend e devolver a
resposta que o backend mandar. **Nenhuma regra de negocio** mora aqui: identidade, vinculo, RBAC, deduplicacao
definitiva, limite por remetente, Command Engine e auditoria sao do backend (`POST /service/whatsapp/ingest`).

```
WhatsApp <-> Baileys <-> [ whatsapp-gateway ] --POST /service/whatsapp/ingest (X-Service-Token)--> backend
                              |  filtros, fila, limite de respostas,             (identidade, RBAC, comandos,
                              |  reconexao                                        auditoria, idempotencia)
                              +<-- { reply, replyTo } -- responde SO ao chat de origem e SO se o backend mandar
```

O gateway **nao abre porta**, **nao tem rota**, **nao envia nada por iniciativa propria** (nao existe API de envio) e
**nao fala com o n8n**.

## 2. Versoes e dependencias (verificado em 2026-11-05)

| Item | Valor |
| --- | --- |
| Pacote | `@whiskeysockets/baileys` **7.0.0-rc14** (exata; tag `latest` do npm; `legacy` = 6.7.24) |
| Node | biblioteca exige `>=20`; o projeto usa `>=24.15.0` (mesma base do backend: `node:24.15.0-bookworm-slim`) |
| Modulo | Baileys e **ESM** (`"type": "module"`); o gateway tambem (e por isso e um servico separado do backend CommonJS) |
| Dependencias nativas | **nenhuma**: pacotes de runtime sem `.node`, sem `os`/`cpu`, sem `optionalDependencies` |
| `mysql2` 3.24.6 | driver do MySQL do armazenamento da sessao; JavaScript puro (exato) |
| `libsignal` 6.0.0 | JavaScript puro, vem do npm (nao de `git`); nao precisa de `git` na imagem |
| `whatsapp-rust-bridge` 0.5.4 | ponte em **WASM** embutida; sem binario por plataforma |
| `sharp` | peer **nao opcional** do Baileys, usado so em midia. **Nao e instalado** (`legacy-peer-deps=true` no `.npmrc`); o gateway so trata texto e a biblioteca carrega normalmente sem ele |
| Scripts de instalacao | 2 pacotes os declaram (Baileys: checagem de versao do Node; `protobufjs`: aviso); ficam **desligados** (`ignore-scripts=true`) |
| Vulnerabilidades | `npm audit --omit=dev`: **0**. Em desenvolvimento ha 1 aviso moderado (`minimatch`, via `typescript-eslint`), sem efeito no runtime |

**Importante:** 7.0.0-rc14 e um **release candidate**. O projeto fixa a versao exata, o `package-lock.json` e um teste
(`baileys-contract.spec.ts`) que **quebra** se um codigo de `DisconnectReason` ou o formato de JID mudar. Nao atualizar sem
repetir os testes e um ensaio com numero de teste.

**Docker (bookworm-slim): NAO validado.** O Docker Desktop estava desligado; nenhuma imagem foi construida. O `Dockerfile`
existe (mesma base do backend, usuario `node`, sem `EXPOSE`), mas so um `docker build` real confirma. Do que foi possivel
checar sem Docker (ausencia de binarios nativos, lockfile reprodutivel) nao ha motivo para incompatibilidade com glibc.

## 3. Estrutura (`whatsapp-gateway/src/`)

| Arquivo | Papel |
| --- | --- |
| `baileys-socket.ts`, `baileys-auth-codec.ts` | **unicos** que importam o Baileys: o socket real (logger silencioso, sem historico, sem QR) e o codec do estado de autenticacao (`BufferJSON`) |
| `session-crypto.ts` | AES-256-GCM com contexto autenticado; leitura estrita da chave |
| `encrypted-session-store.ts` | `SessionStore` real: cifra, fila de escrita, trava de instancia unica, falha fechada |
| `mysql-session-repository.ts` | unico acesso ao MySQL (SQL parametrizado, so as 2 tabelas, trava pelo relogio do banco) |
| `session-repository.ts` | porta do repositorio (e `LeaseLostError`) |
| `ports.ts` | portas: `WaSocketPort`, `SessionStore`, `IngestClient`, `Clock`, `Scheduler` (o nucleo nao conhece a biblioteca) |
| `gateway.ts` | orquestracao: conexao, fila, filtros, encaminhamento, resposta, reconexao |
| `message-filter.ts` | decide o que vira chamada ao backend (puro) |
| `ingest-client.ts` | unico cliente HTTP do backend (timeout, sem redirect, resposta limitada, erros sem dados) |
| `reconnect-policy.ts` | `DisconnectReason` -> reconectar (backoff + jitter + limite) ou parar |
| `reply-limiter.ts`, `seen-ids.ts` | limite global de respostas; primeira barreira contra id repetido |
| `logger.ts` | log JSON de vocabulario fixo (sem texto, numero, JID, token) |
| `config.ts` | variaveis de ambiente (so aqui e em `main.ts`); erros sem repetir valores |
| `main.ts` | composicao; sem `GATEWAY_CONNECT_ENABLED=true` so verifica (trava, chave, estado) e sai |
| `testing/` | socket, relogio, agendador, sessao, backend e BANCO em memoria FALSOS |

## 4. O que o gateway aceita e ignora

**Aceita:** `messages.upsert` do tipo `notify`, conversa **individual**, **texto** (1 a 4096 caracteres; `conversation` ou
`extendedTextMessage`, inclusive dentro de mensagem temporaria), de **outra pessoa**, **recente** (ate 10 min; ate 5 min a
frente do relogio). E com o **telefone do remetente verificado** (secao 6): remetente so com LID e descartado.

**Ignora (com motivo fixo, so contador e log sem dados):** historico (`append`), mensagem propria, grupo, lista de
transmissao, status, newsletter, JID desconhecido, evento de sistema, reacao, edicao, protocolo (apagar/editar),
encaminhada, **LID sem telefone verificado, `remoteJidAlt` invalido e identidade contraditoria** (secao 6), imagem/audio/documento/figurinha/localizacao/enquete e qualquer outro tipo, texto vazio ou acima de 4096,
sem id ou sem timestamp, antiga, do futuro, id repetido, e tudo que chegar antes de a conexao abrir. Na biblioteca,
`shouldIgnoreJid` ja descarta grupos, broadcasts, status e newsletters.

**Resposta:** so se o backend devolver `reply` **e** `replyTo` igual ao remetente que o gateway enviou. O envio vai ao
**chat guardado da mensagem recebida** (nunca a um endereco montado a partir da resposta). Limite global de respostas
(padrao 20/min; excesso descartado), timeout de envio, **uma tentativa** (sem reenvio).

## 5. Reconexao

| Codigo (`DisconnectReason`) | Acao |
| --- | --- |
| 401 `loggedOut` | **PARA**, chama `SessionStore.invalidate()` (a conta saiu do aparelho); so novo pareamento resolve |
| 440 `connectionReplaced` | **PARA** sem apagar a sessao (outra instancia a usa); nao disputar |
| 500 `badSession`, 403 `forbidden`, 411 `multideviceMismatch` | **PARA** |
| 515 `restartRequired` | reconecta ja (esperado apos o pareamento); apos 3 seguidos vira falha comum |
| demais (queda, timeout, 503...) | backoff 2 s x2 ate 60 s, jitter +-20%, **8 tentativas seguidas**, depois PARA |
| conexao estavel por 1 min | zera a contagem de quedas |

Conta conectada diferente de `GATEWAY_ACCOUNT` (ou desconhecida): **para sem encaminhar nada**.

## 6. Identificacao do remetente: so TELEFONE verificado (LID nunca vira telefone)

O WhatsApp esta migrando de numero de telefone (PN, `...@s.whatsapp.net`) para **LID** (`...@lid`), um identificador
opaco. Os digitos de um LID **nao sao** um telefone e podem coincidir com o numero de **outra pessoa** ja vinculada no
backend. Por isso o gateway adota a regra mais simples e segura: **so encaminha ao backend uma mensagem cujo telefone do
remetente foi estabelecido de forma confiavel**. A identidade enviada ao backend (`from`) e **sempre** esse telefone.

### Como o telefone confiavel e estabelecido (`resolveSenderPhone` em `message-filter.ts`)

Regra unica e fechada. Telefone valido = formato E.164 sem `+`: **8 a 15 digitos, sem zero a esquerda**.

| Situacao | Resultado |
| --- | --- |
| chat `@s.whatsapp.net` com telefone valido | `from` = o telefone do chat (`phoneSource: chat-pn`) |
| chat `@lid` **e** `remoteJidAlt` e um JID `@s.whatsapp.net` bem formado com telefone valido | `from` = o telefone do `remoteJidAlt` (`phoneSource: lid-com-telefone`); os digitos do LID nao entram na identidade |
| chat `@lid` sem `remoteJidAlt` (ausente, `null`, vazio) ou com `remoteJidAlt` que e outro LID | **descartada**: `lid-sem-telefone` |
| `remoteJidAlt` presente mas malformado, de tipo que nao e telefone/LID, ou com telefone/LID invalido | **descartada**: `jid-alt-invalido` |
| chat de telefone com **outro** telefone em `remoteJidAlt` | **descartada**: `identidade-contraditoria` |
| conversa individual com `participant` preenchido | **descartada**: `identidade-contraditoria` |
| chat `@lid` com usuario nao numerico, ou chat de telefone fora do E.164 | **descartada**: `remetente-invalido` |
| JID do chat malformado ou de tipo desconhecido | **descartada**: `jid-nao-suportado` |

Antes de chamar o backend o nucleo ainda **repete** a checagem do formato do telefone (defesa em profundidade;
`telefone-nao-verificado`). Mensagem descartada = **nenhuma chamada ao backend, nenhuma resposta, nenhum vinculo**
(inclusive `/vincular`: um LID sem telefone nao consegue sequer vincular).

**O que NAO e usado:** os digitos do LID como identidade; `remoteJidAlt` sem validar o tipo do JID; `addressingMode` (nao
ha como confiar nele sem conta real); qualquer campo da resposta do backend para escolher o destino.

### Resposta
Continua indo ao **chat original** (`remoteJid` guardado da mensagem recebida), inclusive quando ele e um LID cujo telefone
foi verificado. O gateway nunca monta um destino a partir de `from` nem da resposta do backend.

### Garantia testada (com socket falso)
- um LID cujos digitos sao **iguais ao telefone de um usuario vinculado** nunca chega ao backend (sem telefone) e, com o
  telefone real do atacante, chega **com o telefone do atacante**, nunca o da vitima; a vitima por telefone continua
  funcionando;
- PN valido, LID com PN confiavel, LID sem PN, JIDs malformados e dados contraditorios (`message-filter.spec.ts` e
  `gateway.spec.ts`); um teste de arquitetura garante que `from` so vem de `resolveSenderPhone`;
- reintroduzir a falha antiga (usar os digitos do LID) faz **10 testes quebrarem**.

### Consequencias e limites (ainda NAO validados com conta real)
- **Usuarios que o WhatsApp entrega so como LID, sem telefone, ficam SEM resposta e sem vinculo** (silencio). Isso e o preco
  da regra segura. Se isso for comum no numero dedicado, a solucao e **resolver LID -> telefone** de forma confiavel (mapa
  LID do Baileys ou contrato novo com o backend, com tipo explicito de identidade) - decisao da etapa de validacao, nunca
  um "chute" pelos digitos.
- Nao sabemos se, e quando, o WhatsApp preenche `remoteJidAlt` em conversas 1:1 reais, nem se `participant` aparece em
  conversas individuais legitimas (hoje descartamos, por seguranca). So o teste com um **numero dedicado** responde.
- A seguranca desta regra **nao esta comprovada para o WhatsApp real**: so para o comportamento descrito nos testes com
  socket falso e na versao 7.0.0-rc14 (release candidate).

## 7. Armazenamento da sessao (etapa 3): cifrado, persistente, de instancia unica

> **Estado: implementado e testado com banco FICTICIO em memoria.** NAO foi validado contra um MySQL real nem em Docker
> (ver 7.8). Nenhuma conta foi conectada e nenhum QR foi gerado.

### 7.1 O que e guardado e onde
O estado de autenticacao do Baileys = credenciais (`creds`) + chaves Signal (pre-keys, sessoes, sender keys, chaves de
sincronizacao...). Quem le isso **controla a conta do WhatsApp**. Fica em duas tabelas criadas pela **migration do backend**
(`1791800000000-WhatsappAuthState`, MySQL e Oracle; o backend NAO tem entity nem codigo que as leia, e um teste garante):

| Tabela | Conteudo |
| --- | --- |
| `whatsapp_auth_state` | uma linha por item: `(session_id, item_type, item_id)` -> `payload` (BLOB cifrado) |
| `whatsapp_auth_lock` | UMA linha por sessao: dono, validade da trava (relogio do banco) e geracao |

Nada de arquivos: `useMultiFileAuthState` nao e usado (o proprio Baileys o descreve no codigo-fonte como nao indicado para
producao: muitos arquivos soltos, sem trava, sem cifra). O gateway nao escreve em disco.

### 7.2 Cifra (`session-crypto.ts`)
- **AES-256-GCM**, envelope `versao(1) | nonce(12) | texto cifrado | tag(16)`; nonce **aleatorio a cada gravacao**.
- A tag autentica tambem o **contexto** (sessao, tipo e id do item): copiar uma linha para outro lugar (ou outra sessao)
  **nao decifra**.
- A chave e **exclusiva do gateway** (`GATEWAY_AUTH_ENCRYPTION_KEY[_FILE]`), **sem valor padrao**, 32 bytes aleatorios em base64
  ou 64 hex (`openssl rand -base64 32`). Recusa tamanho errado e chaves fracas (menos de 16 bytes distintos). Nunca aparece em
  log, erro, `JSON` ou `inspect` (campo privado `#key`, mensagens fixas). **A chave NAO fica no banco nem no backup do banco.**
- Rotacao da chave **nao esta implementada** (o envelope ja carrega versao para isso).

### 7.3 Escritas e concorrencia (`encrypted-session-store.ts`)
- Todas as escritas passam por **uma fila FIFO**: ordem preservada, nada se intercala.
- `creds.update` repetidos sao **juntados** e gravam a fotografia **mais recente** no momento da escrita; um pedido durante a
  gravacao gera nova gravacao depois dela. As chaves vao em **lote atomico** (tudo ou nada, em transacao).
- Erro de escrita => `falha-gravar-sessao` e o gateway **para**: seguir usando chaves que nao foram persistidas corromperia a
  sessao (o ratchet do Signal avanca). O erro do driver (pode citar host/usuario/SQL) **nunca** sobe: so mensagem fixa.

### 7.4 Trava de instancia unica
- `open()` toma a trava (`acquireLease`); um heartbeat a renova a cada 10 s (validade 30 s). A validade usa o **relogio do
  banco**, nao o da maquina.
- **Toda escrita confere a posse da trava na MESMA transacao** (`SELECT ... FOR UPDATE`): um dono antigo, mesmo sem saber que
  perdeu a trava, **nao grava** (`LeaseLostError`). Trava vencida nao e "ressuscitada" pelo dono antigo.
- Segunda instancia com a mesma sessao: `sessao-em-uso` (nao disputa, nao toca no banco). Perda da trava (heartbeat falhou
  duas vezes seguidas, renovacao recusada, escrita recusada): `trava-perdida` e o gateway **para**.
- Sessoes diferentes (`GATEWAY_SESSION_ID`) nao se bloqueiam.

### 7.5 Falha fechada
| Situacao | Resultado |
| --- | --- |
| Chave de cifra errada | `sessao-ilegivel`; **nada e sobrescrito**; a trava e solta |
| Credenciais corrompidas, truncadas ou adulteradas | `sessao-ilegivel` |
| Chaves sem credenciais (estado inconsistente) | `sessao-ilegivel`; **nao** cria credenciais novas por cima |
| Chave Signal corrompida em tempo de execucao | `sessao-ilegivel`, e o armazenamento passa a recusar tudo |
| Banco indisponivel ao abrir | `sessao-indisponivel` (nao e fatal: pode tentar de novo) |
| Sessao nunca existiu | cria credenciais novas e as grava (novo pareamento) |

Depois de um erro fatal o objeto fica **inutilizavel** (o processo precisa reiniciar). Uma sessao valida **nunca** e recriada
por causa de um erro de chave ou de leitura: isso a destruiria por um erro de configuracao.

### 7.6 Logout definitivo (`loggedOut`)
`invalidate()` apaga **somente as linhas da propria sessao** em `whatsapp_auth_state` (nunca outras sessoes, a linha da
trava, outras tabelas ou configuracoes) e o gateway para. Novo uso exige novo pareamento.

### 7.7 Banco, backup e segredos
- **Usuario de banco restrito** (criado por quem administra o MySQL; o backend/migration nao cria usuarios):
  ```sql
  CREATE USER 'whatsapp_gateway'@'%' IDENTIFIED BY '<senha forte, so no arquivo de segredo>';
  GRANT SELECT, INSERT, UPDATE, DELETE ON `<banco>`.`whatsapp_auth_state` TO 'whatsapp_gateway'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON `<banco>`.`whatsapp_auth_lock`  TO 'whatsapp_gateway'@'%';
  ```
  Sem `DROP`, `ALTER`, `CREATE`, `TRUNCATE` e **sem acesso a nenhuma outra tabela** (financeiro, auditoria, NFS-e...).
- **Backup (`scripts/backup.sh`)**: as duas tabelas ficam **sem dados** no `mysqldump` (so a estrutura vai, vazia, porque a
  tabela `migrations` as registra; sem elas a restauracao quebraria). Todas as demais tabelas seguem completas. Resultado: um
  backup roubado ou restaurado **nao contem a sessao**; restaurar exige novo pareamento por QR. O `.env`/arquivos de segredo
  que o backup guarda (cifrados com GPG) podem conter a **chave** de cifra, mas sem a sessao ela nao abre nada.
- **Segredos** (chave de cifra, senha do banco, credencial de servico): arquivos montados somente leitura
  (`GATEWAY_*_FILE`), **nunca** no Git, em imagem, em argumento de linha de comando ou em log. O `.gitignore` do gateway bloqueia
  `creds.json`, `auth_info*/`, `*.session` e `.env*`.
- A chave de cifra **nao deve ficar so no mesmo lugar** que o banco; guarde-a no cofre/gerenciador de segredos de quem opera.
  **Perder a chave = perder a sessao** (novo pareamento), nunca perder dados do VastaFlow.

### 7.8 Verificacao sem conexao
Sem `GATEWAY_CONNECT_ENABLED=true` o processo **so verifica** e sai: valida a configuracao, toma a trava, confere que a chave
decifra o estado (ou que a sessao ainda e `vazia`), solta a trava e termina com codigo 0. **Nao abre socket e nao fala com o
WhatsApp.** E o comando para validar o armazenamento no Docker antes de qualquer pareamento.

### 7.9 O que ainda PRECISA ser comprovado (nao esta comprovado)
- **MySQL real**: `mysql-session-repository.integration.spec.ts` existe (aplica o DDL REAL da migration, cria usuario restrito,
  testa trava, corrida pela primeira trava, expiracao pelo relogio do banco, atomicidade, dono antigo sem escrita, ida e volta
  binaria, privilegios, concorrencia e recuperacao com o codec real). Ele fica **desligado** sem `GATEWAY_TEST_MYSQL_ROOT_URL`
  e **nao foi executado** com sucesso nesta etapa (ver o relatorio da etapa: o MySQL descartavel local nao iniciou).
- **Docker**: persistencia entre `docker restart`/recriacao do conteiner, `docker build` da imagem, rede interna com o
  MySQL, montagem dos segredos somente leitura, e o `backup.sh`/restauracao reais com as duas tabelas vazias.
- **Falhas reais de rede**: queda do MySQL no meio de uma escrita e comportamento do pool.
- **Oracle**: o DDL existe, mas o acesso do gateway so esta implementado para MySQL; nunca executado.

## 8. Execucao local e testes

Pre-requisito: Node `>=24.15.0` (o Node local de desenvolvimento pode ser um pouco mais antigo; o `npm` apenas avisa).

```
cd whatsapp-gateway
npm ci                 # versoes exatas, scripts de instalacao desligados
npm run typecheck && npm run lint && npm run format:check
npm run build
npm test               # socket e banco FALSOS, nenhuma conta, nenhuma rede externa
```

Os testes usam um servidor HTTP **local** em loopback no lugar do backend e dados ficticios. `baileys-contract.spec.ts`
importa a biblioteca real **sem conectar** para conferir versao exata, codigos de `DisconnectReason` e formato de JID.

Execucao do processo (**verificacao**, sem conta e sem conexao com o WhatsApp): defina as variaveis de
`whatsapp-gateway/.env.example` (segredos em ARQUIVO) e rode `node dist/main.js`. Sem `GATEWAY_CONNECT_ENABLED=true` ele valida
a configuracao, toma a trava, confere que a chave decifra o estado, solta a trava e termina (codigo 0, eventos
`sessao-verificada` e `conexao-desabilitada`). Com a chave errada, a sessao ocupada ou o banco fora, termina com codigo 1 e
um motivo fixo no log. Nunca passe segredo em argumento de linha de comando.

Teste de integracao contra um MySQL DESCARTAVEL (fora do `npm test`): defina `GATEWAY_TEST_MYSQL_ROOT_URL`
(`mysql://root@127.0.0.1:<porta>`; nunca o banco da VPS) e rode
`node --test dist-test/mysql-session-repository.integration.spec.js` depois de `npm test`.

## 9. Riscos de seguranca e operacao

- **Biblioteca nao oficial** (WhatsApp Web): risco real de restricao/banimento da conta; Termos do WhatsApp. Numero
  **dedicado**, nunca o principal da Quasar; so respostas a quem escreveu e esta vinculado; sem envio em massa nem
  proativo (o desenho nao permite).
- **Gateway comprometido** = pode afirmar um `from` ja vinculado (confianca descrita em `whatsapp.md`, secao 1.1).
  Mitigacoes: principal/escopo proprios, rede interna, sem porta publicada, credencial rotacionavel.
- **Release candidate:** fixar versao; atualizar so com testes e ensaio.
- **Privacidade:** o texto das mensagens passa pelo gateway; ele **nao** o registra (log de vocabulario fixo, com testes) e
  nao tem armazenamento. Atualizar a politica de privacidade antes de usar com pessoas reais.
- **Sessao em banco:** quem tiver a chave E o banco controla a conta do WhatsApp. Por isso a cifra, o usuario de banco restrito, a
  exclusao do backup e segredos so em arquivo. O gateway e o backup do `.env` (GPG) podem guardar a chave; a sessao, nao.
- **Nao validado:** conexao real, QR, `remoteJidAlt`/LID, comportamento do WhatsApp, imagem Docker, **MySQL real e Docker para o
  armazenamento (secao 7.9)**.

## 10. Proximas etapas

3. (feita, nao comprovada em MySQL real/Docker) `SessionStore` definitivo: tabela cifrada, migration no backend, trava de
   instancia unica, fora do backup.
4. **Comprovar a etapa 3**: rodar o teste de integracao contra um MySQL real, `docker build`, persistencia entre reinicios do
   conteiner, trava com duas instancias, backup/restauracao com as duas tabelas vazias.
5. Pareamento por QR (CLI administrativa, QR so no terminal do operador, nunca em log) e servico no Compose (endurecido, sem
   portas, segredos em arquivo, usuario de banco restrito).
6. Teste real com numero dedicado e novo (checklist), decisao sobre LID, e so entao ligar para um usuario ADMIN.
