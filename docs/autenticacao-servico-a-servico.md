# Autenticacao servico-a-servico (n8n -> NestJS)

> **Estado: IMPLEMENTADO e validado localmente em Docker Desktop (Fase 3,
> 2026-10-08).** Nao validado: VPS Linux, HTTPS publico, carga real, e qualquer
> uso por workflow de negocio (nao existe nenhum - ver secao 11).
>
> Decisao de origem: [`adr/0003-topologia-de-producao.md`](adr/0003-topologia-de-producao.md).
>
> **Fase 5 (2026-10-13):** surgiu o segundo principal, `n8n-telegram` (escopo
> `service:telegram:ingest`), e a segunda rota de servico, `POST /service/telegram/ingest`. A secao
> 6 (ator de negocio) passou a valer **so para esse fluxo** - ver
> [`telegram-n8n.md`](telegram-n8n.md) e o [ADR 0004](adr/0004-telegram-n8n-envelope-assinado.md).

## 1. O que existe

```
n8n --(rede `automation`, HTTP)--> backend:3000   X-Service-Token: vfs_...
```

Duas rotas de servico: a **tecnica** `GET /service/identity` (principal `n8n`) e, desde a Fase 5,
`POST /service/telegram/ingest` (principal `n8n-telegram`; **nao** e tecnica - executa comandos em nome
da pessoa vinculada, exigindo um envelope assinado). Sobre a rota tecnica: Devolve quem
esta chamando (`authenticatedAs: "service"`, `principal`, `credentialId`,
`scopes`). Nao le nem altera dado de negocio, nao executa comando e nao aceita
nem devolve identificador de usuario. **Nao e uma API de comandos** e nao ha
planos de transforma-la em uma.

Na borda publica ela nao existe: o Nginx responde 404 para `/api/service*`
(qualquer caixa, com `%XX`, `//`, `/./`). O n8n chega direto ao backend pela
rede interna.

## 2. SERVICE PRINCIPAL != BUSINESS ACTOR

| | Pergunta | Exemplo | Sujeito de |
| --- | --- | --- | --- |
| **Service principal** | *Qual sistema* chama? | o n8n | **autenticacao** (existe) |
| **Business actor** | *Qual pessoa* originou? | usuario vinculado ao numero de WhatsApp | **acao de negocio** (NAO existe ainda) |

Combinacoes: pessoa no React (so ator); pessoa via WhatsApp/Telegram (**ator =
a pessoa**, servico como contexto); tarefa agendada (servico, **sem** ator - e
correto registrar a ausencia); nenhum dos dois (nao existe).

**Nao foi criado usuario "N8N"** na tabela `users` (verificado no MySQL real: 1
usuario, o administrador). `criado_por_id`, `documents`, financeiro e
`audit_logs` nao foram alterados. O servico **nao e uma pessoa** e nunca
aparece como autor.

## 3. Credencial

| Propriedade | Implementacao |
| --- | --- |
| Formato | `vfs_` + base64url de 32 bytes aleatorios (256 bits, `crypto.randomBytes`) |
| Cabecalho | `X-Service-Token` (proprio; `Authorization: Bearer` e recusado nas rotas de servico) |
| No servidor | arquivo de **hashes SHA-256** (`credentials.json`); o token nunca e gravado |
| Comparacao | `timingSafeEqual` sobre digests de tamanho fixo, percorrendo **todos** os registros |
| No n8n | credencial do cofre (Header Auth), **cifrada** no PostgreSQL |
| Em log / resposta | nunca (testado em unidade, e2e e nos logs dos containers) |
| Mensagem de erro | uma so: `Credencial de servico invalida` (ausente, malformada, desconhecida, revogada, expirada, arquivo indisponivel) |

O motivo real da recusa vai **so para o log do servidor** (`motivo=revoked`
etc., com metodo, caminho sem query e o endereco do **socket** - nao
`X-Forwarded-For`).

## 4. Guards e autorizacao

Ordem global (`AuthModule`): `ServiceAuthGuard` -> `JwtAuthGuard` ->
`RolesGuard` -> `PermissionsGuard`.

- Rota sem `@ServiceRoute`: `ServiceAuthGuard` devolve `true` sem olhar nada;
  o fluxo humano e **identico** ao anterior (o spec antigo do `JwtAuthGuard`
  passa sem nenhuma alteracao).
- Rota com `@ServiceRoute(escopo...)`: autentica o token, confere os escopos
  (falta -> 403) e anexa `request.servicePrincipal`. O `JwtAuthGuard`, nesta
  rota, **so confirma** que a identidade foi anexada; sem ela, 401
  (**fail-closed**: se o guard de servico sumisse da lista, a rota negaria, nao
  abriria).
- Um JWT de pessoa **nao** autentica rota de servico, e o token de servico
  **nao** autentica rota de pessoa (a rota nem o considera: devolve
  `Token de acesso ausente`).
- Nada de `@Public()`; um token valido **nao** contorna os guards de pessoa.

Escopos vivem no codigo (`service-principals.ts`). O principal `n8n` tem
**somente** `service:identity`. Nao tem `users:*`, `finance:*`, `documents:*`
nem perfil administrativo, e nao reaproveita nenhum usuario humano.

Um teste e2e de **classificacao** falha se surgir rota publica nova (hoje:
`GET /health`, `GET /health/readiness`, `POST /auth/login`, `POST
/auth/register`) ou rota de servico nova (hoje: so `GET /service/identity`).

## 5. Operacao: criar, rotacionar, revogar

A administracao e um CLI que ja vai na imagem do backend. Nao exige banco,
painel nem reinicio. O diretorio `infra/service-auth/` e do operador (fora do
Git) e o backend o monta **somente leitura**.

```bash
mkdir -p infra/service-auth
CLI="docker run --rm -v $PWD/infra/service-auth:/data --entrypoint node \
     <imagem-do-backend> dist/modules/service-auth/service-credential.cli.js"

# criar (o token sai UMA vez no stdout; avisos no stderr)
$CLI create --file /data/credentials.json --id n8n-2026-10 --principal n8n \
     [--expires-in-days 90]  > token.txt
$CLI list   --file /data/credentials.json
$CLI revoke --file /data/credentials.json --id n8n-2026-10
```

**Rotacao (sem indisponibilidade):** (1) `create` uma segunda credencial - as
duas ficam ativas; (2) colocar o novo token na credencial do n8n; (3) confirmar
que o trafego usa a nova (`credentialId` na resposta / log); (4) `revoke` a
antiga; (5) apagar `token.txt`.

**Revogacao - latencia real.** O backend relê o arquivo no maximo a cada
**1 s** (TTL do store). Nao ha reinicio de container. **Medido** no bind mount
do Docker Desktop: token recusado **0,54 s** depois do fim do CLI (uma
execucao; o limite de projeto e ~1 s + propagacao do mount). Isso e "em
segundos", nao instantaneo. Em Linux nativo a propagacao do bind mount e
imediata, mas **nao foi medida**.

**Fail-closed:** arquivo ausente, ilegivel, JSON invalido ou com campo
desconhecido (`statuss`) **nega todo acesso de servico** (e loga o motivo); ao
consertar o arquivo, volta sozinho. Sem `SERVICE_CREDENTIALS_FILE` o recurso
fica desligado (tudo 401) e a aplicacao sobe normalmente.

**Linux (VPS):** o CLI grava o arquivo com modo 0644 (so hashes). O diretorio
precisa ser legivel pelo uid do container (1000). Nao foi validado em Linux.

**Backup:** o arquivo e pequeno e recriavel (basta emitir nova credencial e
atualizar o n8n). Nao ha segredo utilizavel nele.

## 6. Contrato: propagar o ATOR DE NEGOCIO (implementado so para o Telegram, Fase 5)

> **Fase 5:** os itens 1-5 abaixo estao implementados em `POST /service/telegram/ingest` (o n8n envia o
> id do remetente NO TELEGRAM dentro de um envelope **assinado pelo backend**; o backend resolve a pessoa
> e aplica o RBAC dela; o servico nunca e o ator). Na auditoria nao houve migration: `usuarioId` e a
> pessoa e o principal/credencial vao em `metadados` (`CHANNEL_MESSAGE`). Outras rotas de servico ainda
> **nao** propagam ator.

Quando um workflow executar acao em nome de uma pessoa:

1. O n8n envia o **identificador do canal** (ex.: id do chat/numero), **nunca**
   um id de usuario VastaFlow, e **nunca** como autoridade.
2. O NestJS resolve a pessoa por `external_identity_links` (ja existe) e
   aplica **as permissoes dessa pessoa**, nao as do servico.
3. Sem vinculo ativo -> recusa; o servico nao "vira" ninguem.
4. A auditoria registra a acao do dominio, com a pessoa como autor e o servico
   como contexto; sem pessoa, registra a **ausencia**.
5. `usuarioId`/`criado_por_id` vindos do corpo da requisicao continuam
   proibidos. Um id enviado pelo n8n **nao** e confiado.
6. Exigira escopos novos e especificos (nunca o escopo `service:identity`
   ampliado), e decisao sobre a coluna de ator na auditoria (migration).

Nada disso foi construido nesta fase.

## 7. Auditoria e logs

- A rota tecnica **nao grava** em `audit_logs` (verificado: nenhum registro
  cita servico/n8n/token). O vocabulario de acoes nao foi ampliado.
- O log do servidor registra recusas e mudancas de estado do arquivo (`ativas=
  [n8n/<id>] revogadas=N`), **sem hashes e sem tokens**.

## 8. Protecoes de infraestrutura

| Protecao | Onde | Estado |
| --- | --- | --- |
| Rota nao publica | Nginx `/api/service*` -> 404 | validado (10 variantes) |
| Rede | n8n e backend em `automation`; o MySQL fora | validado |
| TLS entre n8n e backend | **nao existe** (HTTP na rede Docker interna) | risco aceito localmente |
| Replay | aceito como risco residual; HMAC+nonce e o upgrade | nao implementado |
| Rate limit da rota | nao ha (o n8n nao passa pelo Nginx) | pendente |

## 9. Decisoes (antes "abertas")

1. **Representacao do autor:** nao decidida para escrita de negocio (secao 6);
   a rota tecnica nao grava autoria.
2. **Lista de endpoints autorizados:** escopos no **codigo**, por principal.
3. **Revogacao:** arquivo de hashes relido a cada 1 s (secao 5).
4. **Mais de um principal:** o desenho comporta (enum + mapa). Hoje: `n8n` (identidade) e `n8n-telegram`
   (ingestao do Telegram), com escopos disjuntos.

## 10. Fora de escopo

Autenticacao humana (inalterada); `external_identity_links` (inalterado);
`financial_entries`, `documents`, `audit_logs` (inalterados); workflows de
negocio, WhatsApp, Plantae pelo n8n, NFS-e (nao implementados). O Telegram via n8n passou a existir na
Fase 5 ([`telegram-n8n.md`](telegram-n8n.md)).

## 11. Workflows

Na Fase 3 so existiram workflows **descartaveis, de validacao**. Na Fase 5 existe **um** workflow
versionado, `integrations/telegram/n8n/vastaflow-telegram-ingest.workflow.json` (entrada do Telegram):
sem segredo e **inativo por padrao**. Nenhum canal real foi configurado.
