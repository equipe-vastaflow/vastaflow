# WhatsApp Gateway (Baileys) - etapa 2

> **Estado: o gateway existe e esta TESTADO com socket FALSO. Nenhuma conta foi conectada, nenhum QR Code foi gerado,
> nenhuma mensagem real foi enviada ou recebida, o servico NAO esta no Compose de producao e `WHATSAPP_ENABLED`
> continua `false`.** Mesmo montado com configuracao valida, o gateway **nao consegue conectar**: o armazenamento da
> sessao (etapa 3) ainda nao existe e o placeholder recusa abrir.
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
| Dependencias nativas | **nenhuma**: 64 pacotes de runtime, sem `.node`, sem `os`/`cpu`, sem `optionalDependencies` |
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
| `baileys-socket.ts` | **unico** que importa o Baileys; adapta o socket real a `WaSocketPort` (logger silencioso, sem historico, sem QR) |
| `ports.ts` | portas: `WaSocketPort`, `SessionStore`, `IngestClient`, `Clock`, `Scheduler` (o nucleo nao conhece a biblioteca) |
| `gateway.ts` | orquestracao: conexao, fila, filtros, encaminhamento, resposta, reconexao |
| `message-filter.ts` | decide o que vira chamada ao backend (puro) |
| `ingest-client.ts` | unico cliente HTTP do backend (timeout, sem redirect, resposta limitada, erros sem dados) |
| `reconnect-policy.ts` | `DisconnectReason` -> reconectar (backoff + jitter + limite) ou parar |
| `reply-limiter.ts`, `seen-ids.ts` | limite global de respostas; primeira barreira contra id repetido |
| `logger.ts` | log JSON de vocabulario fixo (sem texto, numero, JID, token) |
| `config.ts` | variaveis de ambiente (so aqui e em `main.ts`); erros sem repetir valores |
| `session-store.ts` | placeholder que **recusa** abrir sessao (ate a etapa 3) |
| `main.ts` | composicao; sai com codigo 1 enquanto nao houver sessao |
| `testing/fakes.ts` | socket, relogio, agendador, sessao e backend FALSOS |

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

## 7. Contrato com a etapa 3 (armazenamento da sessao)

`SessionStore` (em `ports.ts`) e a **unica** interface que a etapa 3 precisa implementar:

```ts
interface SessionStore {
  open(): Promise<SessionHandle>;   // { state, save() }  - estado de autenticacao (opaco) e como salva-lo
  invalidate(): Promise<void>;      // loggedOut: apagar a sessao
}
```

Requisitos da implementacao definitiva (nada disso existe ainda): credenciais **e** chaves Signal em tabela propria,
**cifradas** (AES-256-GCM, chave fora do banco), escrita serializada e transacional, **trava de instancia unica** (duas
instancias com a mesma sessao causam `connectionReplaced` e risco para a conta), usuario de banco restrito a essa tabela,
tabela **fora do `mysqldump`**. `useMultiFileAuthState` **nao** sera usado em producao. O estado nunca vai a log, Git ou
imagem. Nesta etapa `NotImplementedSessionStore` **recusa** abrir, de proposito: nenhuma conta pode conectar sem um lugar
seguro para a sessao.

## 8. Execucao local e testes

Pre-requisito: Node `>=24.15.0` (o Node local de desenvolvimento pode ser um pouco mais antigo; o `npm` apenas avisa).

```
cd whatsapp-gateway
npm ci                 # versoes exatas, scripts de instalacao desligados
npm run typecheck && npm run lint && npm run format:check
npm run build
npm test               # 185 testes, socket FALSO, nenhuma conta, nenhuma rede externa
```

Os testes usam um servidor HTTP **local** em loopback no lugar do backend e dados ficticios. `baileys-contract.spec.ts`
importa a biblioteca real **sem conectar** para conferir versao exata, codigos de `DisconnectReason` e formato de JID.

Execucao do processo (sem conta, so para ver a configuracao): o gateway valida as variaveis (ver
`whatsapp-gateway/.env.example`), monta tudo e **para** com `sessao-indisponivel` (codigo 1). Isso e o comportamento esperado
nesta etapa. A credencial de servico real nunca vai em argumento de linha de comando: use arquivo
(`GATEWAY_SERVICE_TOKEN_FILE`).

## 9. Riscos de seguranca e operacao

- **Biblioteca nao oficial** (WhatsApp Web): risco real de restricao/banimento da conta; Termos do WhatsApp. Numero
  **dedicado**, nunca o principal da Quasar; so respostas a quem escreveu e esta vinculado; sem envio em massa nem
  proativo (o desenho nao permite).
- **Gateway comprometido** = pode afirmar um `from` ja vinculado (confianca descrita em `whatsapp.md`, secao 1.1).
  Mitigacoes: principal/escopo proprios, rede interna, sem porta publicada, credencial rotacionavel.
- **Release candidate:** fixar versao; atualizar so com testes e ensaio.
- **Privacidade:** o texto das mensagens passa pelo gateway; ele **nao** o registra (log de vocabulario fixo, com testes) e
  nao tem armazenamento. Atualizar a politica de privacidade antes de usar com pessoas reais.
- **Nao validado:** conexao real, QR, `remoteJidAlt`/LID, comportamento do WhatsApp, imagem Docker.

## 10. Proximas etapas

3. `SessionStore` definitivo (tabela cifrada, migration no backend, trava de instancia unica, fora do backup).
4. Pareamento por QR (CLI administrativa, QR so no terminal do operador, nunca em log) e servico no Compose (endurecido,
   sem portas), com `docker build` validado.
5. Teste real com numero dedicado e novo (checklist), decisao sobre LID, e so entao ligar para um usuario ADMIN.
