# Integracao Plantae (API externa, somente leitura)

> **Estado: IMPLEMENTADA, testada com mocks e VALIDADA PARCIALMENTE contra a
> homologacao real (Fases 4.1 a 4.4).** Ver [Validacao real](#71-validacao-real-fases-41-a-44):
> 7 dos 8 endpoints foram chamados; **`issued-invoices` nao** (a chave nao tem o
> escopo), e do **extrato** so o envelope e os saldos foram validados: a conta
> testada voltou **sem movimentos**, entao as **linhas do extrato nao estao
> comprovadas**. A organizacao da chave **nao foi comparada** com uma referencia
> confiavel. As pendencias completas estao em [7.2](#72-pendencias-para-encerrar-a-fase-4);
> o que continua so "conforme a colecao" esta em
> [Premissas nao verificadas](#6-premissas-nao-verificadas).
>
> Somente **homologacao** (`rc.plantae.agr.br`). **Nao ha producao**: o endereco
> de producao nao foi informado e nenhum foi inventado.
>
> Fonte unica dos contratos: a colecao Postman oficial "Plantae API Externa"
> (fornecida pela equipe do Plantae). Ela **nao** esta neste repositorio e nao
> deve ser copiada para ele sem decisao explicita: a original pode conter chave.

## 1. O que existe

Oito consultas `GET` ao Plantae, expostas **somente a ADMIN humano** pelo VastaFlow:

| # | Plantae | VastaFlow (`GET`) |
| --- | --- | --- |
| 1 | `/me` | `/integrations/plantae/me` |
| 2 | `/financial/entries` | `/integrations/plantae/financial/entries` |
| 3 | `/financial/accounts` | `/integrations/plantae/financial/accounts` |
| 4 | `/financial/movements` | `/integrations/plantae/financial/movements` |
| 5 | `/financial/account-statement` | `/integrations/plantae/financial/account-statement` |
| 6 | `/fiscal/issued-invoices` | `/integrations/plantae/fiscal/issued-invoices` |
| 7 | `/organization/legal-entities` | `/integrations/plantae/organization/legal-entities` |
| 8 | `/people` | `/integrations/plantae/people` |
| - | (local) | `/integrations/plantae/status` - estado, sem chamar o Plantae |

**Fase 5 - `/contas_pagar` no chat.** Existe **um** comando de conversa, somente leitura, sobre o
`PlantaeService` (`/financial/entries`, despesas pendentes): permissao propria `plantae:read` (so ADMIN),
opt-in `PLANTAE_CHAT_COMMANDS_ENABLED` (desligado), uma pagina de 5 itens, **sem CPF/CNPJ, observacao,
descricao ou rateio**. **Nunca consultou o Plantae real** (testes com `fetch` simulado; no Docker o Plantae
esta desligado). Detalhes em [`telegram-n8n.md`](telegram-n8n.md), secao 7.

**Nao existe**: escrita de qualquer tipo, NFS-e, XML, DANFE, baixa, conciliacao,
sincronizacao, cache, tabela, migration, workflow, canal. A API do Plantae nao
tem rota de escrita; o VastaFlow nao tem verbo de escrita para ela (um teste de
arquitetura falha se aparecer `POST`/`PUT`/`PATCH`/`DELETE`).

## 2. Resumo da colecao

- Todas as rotas sao `GET`, respondem JSON UTF-8, inclusive os erros.
- `Authorization: Bearer <chave>`. A chave define a organizacao; `X-Tenant-Id` e
  opcional (se enviado, tem de ser o da chave) - **o VastaFlow nao o envia**.
- "Cada rota exige um escopo; chave sem ele recebe 403". `GET /me` nao exige escopo
  e lista os escopos. **A colecao so cita dois nomes de escopo, e como exemplo**
  (`financial-entries:read`, `issued-invoices:read`); o escopo de cada rota nao esta
  documentado.
- Paginacao por cursor: `per_page` de 1 a 500 (padrao 100); seguir `links.next` ou
  enviar `meta.next_cursor` em `cursor`; o cursor e **opaco**.
- Lancamentos, movimentacoes, extrato e notas exigem `data_inicio` e `data_fim`
  (`AAAA-MM-DD`, ambos incluidos), periodo de **ate 366 dias**.
- Listas em filtro: `campo[]=1&campo[]=2` (ou `campo=1`).
- Valores: "numeros com ate 2 casas decimais". Lancamentos vem **na moeda do
  titulo** (`titulo.moeda`); movimentacoes, extrato e notas, **em reais**.
- Codificados: `{ "codigo": ..., "descricao": "..." }`. Campo sem valor vem `null` e
  "nunca some da resposta".
- Limite: **60 req/min por chave**; `X-RateLimit-Limit`/`-Remaining`; acima, `429` +
  `Retry-After`. Erros: 401 (sem chave/invalida/expirada/revogada/integracao
  desativada), 403 (sem escopo, `X-Tenant-Id` diferente ou assinatura inativa), 422
  (parametro invalido; `errors` por parametro), 429.

### Particularidades de cada endpoint que mudam o uso

| Endpoint | O que a colecao diz | Cuidado |
| --- | --- | --- |
| `entries` | Uma linha por **parcela**, por **vencimento**. Fora: barter, descontos de venda ja descontados, registros excluidos. `status`: 0 pendente, 1 quitada, **2 substituida** (renegociacao/desmembramento) | Substituida **nao** e cancelada. Parcela existir **nao** significa pagamento. `valor` e o da parcela; `titulo.valor_total` e o do titulo. Moeda **do titulo**: nao somar moedas diferentes |
| `accounts` | Caixa, bancaria, aplicacao, numerario em transito | **Nao traz saldo** |
| `movements` | Fora: movimentos **estornados** e pares de lancamento/estorno de financiamento; compras no cartao **nao** aparecem (aparece o pagamento da fatura); cheque gera uma linha por cheque | **Nao e toda a movimentacao.** `natureza`: C credito, D debito |
| `account-statement` | `meta.saldo_anterior` e `meta.saldo_final`, **iguais em todas as paginas**; "mesmas regras do relatorio Extrato de Conta, a partir do saldo inicial cadastrado" | **Nunca somar** saldos de pagina. Nao e conciliacao |
| `issued-invoices` | **NF-e modelo 55 emitidas**, autorizadas ou canceladas, "**em ambiente de producao**". Fora: em digitacao, sem resposta, rejeitadas, denegadas, inutilizadas. "**Nao entrega XML nem DANFE**" | Nao e NFS-e. Dados vem do que foi enviado a SEFAZ, nao do cadastro atual |
| `legal-entities` | Razoes sociais, CPF/CNPJ do produtor rural principal e a fazenda | Fonte dos `razao_social_id` |
| `people` | Clientes, fornecedores, colaboradores; `busca` por parte do nome/fantasia/razao ou CPF/CNPJ | **Dado pessoal** |

## 3. Configuracao

Todas **desligadas/vazias por padrao**. So o **backend** as recebe (nunca o n8n, o
`migrate` ou o frontend).

| Variavel | Padrao | Regra |
| --- | --- | --- |
| `PLANTAE_ENABLED` | `false` | So `true` liga. Desligado, nada e chamado |
| `PLANTAE_BASE_URL` | vazio | **Fail-fast**: HTTPS, sem usuario/senha/porta/query/fragmento, host **exatamente** `rc.plantae.agr.br`, caminho `/api/v1/external`. Validada **mesmo desligado** |
| `PLANTAE_API_TOKEN` | vazio | Segredo. 8 a 512 caracteres ASCII imprimiveis, sem espaco (impede injecao no cabecalho). Ausente = `NOT_CONFIGURED` (a aplicacao sobe) |
| `PLANTAE_TIMEOUT_MS` | 15000 | 1000 a 60000 |

Estados (`GET /integrations/plantae/status`, local): `DISABLED` (desligado),
`NOT_CONFIGURED` (ligado sem URL ou sem token), `READY`. O Plantae fora do ar
**nao** impede o boot: o registro so guarda a referencia; o health check
(`GET /me`) so roda quando alguem pede e e reaproveitado por 60 s.

**Producao.** O host de producao nao existe no codigo (`PLANTAE_ENVIRONMENTS`
contem so a homologacao). Quando a Plantae liberar, acrescentar o host la e uma
**mudanca de codigo revisada** - de proposito, para nao ser uma variavel que
alguem troque por engano e aponte a integracao para o lugar errado.

## 4. Seguranca e dados pessoais

- **A homologacao contem copia do ambiente da cliente.** Tratar tudo que volta como
  dado real e confidencial.
- **Token**: lido em **um unico arquivo** (`plantae-http.client.ts`), usado em **um
  unico lugar** (`Authorization: Bearer`). Nunca em URL/query/corpo, log, mensagem
  de erro, resposta ou auditoria. Testes de arquitetura garantem isso no codigo e
  testes e2e garantem no comportamento. Limite conhecido: variavel de ambiente
  aparece em `docker inspect` para quem tem acesso ao Docker do host.
- **Sem n8n**: o token nao vai ao n8n e o principal `n8n` continua com o escopo
  `service:identity` apenas. O token de servico **nao** autentica estas rotas
  (testado). O acesso do n8n a dados financeiros exige fase propria, com
  resolucao do usuario de origem.
- **Somente ADMIN humano**, sem rota publica, sem rota de servico.
- **Redirect nao e seguido** (`redirect: 'manual'`); TLS nao e enfraquecido (nao ha
  opcao); `links.next` nunca e seguido como destino.
- **Nada e gravado**: sem cache, tabela ou copia no MySQL.
- **Auditoria** (`PLANTAE_QUERIED`): quem, quando, endpoint, resultado, quantidade,
  periodo e, na falha, o codigo. **Nunca** `busca`, ids de pessoa, conteudo, valores
  ou token.
- **Logs**: so endpoint, paginas, itens, tempo e a categoria da falha. Dois logs que
  gravavam a query string foram corrigidos nesta fase porque `?busca=` pode ser
  CPF/CNPJ: o `AllExceptionsFilter` (backend) e o log de acesso do Nginx
  (`01-log-format.conf`). **Restricao que permanece:** qualquer proxy ou balanceador
  **na frente** do Nginx tera a propria politica de log.
- A **resposta ao chamador** continua ecoando a URL pedida em `path` (formato
  existente do filtro global): e o proprio ADMIN que a enviou.

## 5. Decisoes de contrato (e por que)

- **Dinheiro nunca e `number`.** `JSON.parse` com `reviver` e `context.source`
  (Node >= 21; o projeto exige 24) preserva o **texto** do numero: `8337.10` sai
  `"8337.10"`, sem passar por ponto flutuante e sem arredondar. Notacao cientifica
  (`1e3`) e **recusada**. A regra "ate 2 casas" **nao e imposta**: os exemplos da
  colecao trazem 15+ casas, e arredondar em silencio seria pior que preservar.
  Nao ha soma nem agregacao de valores neste modulo (nao foi necessaria).
  `moneyTransformer` do financeiro local **nao foi tocado**.
- **`null` permanece `null`.** Chave **ausente** e violacao do contrato (a colecao
  diz que nunca some). Campos extras nao documentados **nao** passam adiante.
- **Nulabilidade**: campos escalares e objetos aninhados aceitam `null`; so os
  identificadores primarios e os campos estruturais sao obrigatorios. A colecao e
  gerada a partir de um esquema e nem todo campo anulavel aparece `null` nos
  exemplos; ser leniente aqui nao inventa dado.
- **Sem forma documentada** (`entries[].razao_social`, `resposta_sefaz`,
  `cancelamento`, `fazenda`): so aparecem `null` na colecao. Sao preservados sem
  interpretar (`PlantaeOpaque`).
- **Falha fecha** (fail-closed): resposta fora do contrato falha **inteira** com o
  caminho do campo (`data[1].valor [decimal]`), nunca o valor. Nao ha dado
  parcial nem fallback para dado local.
- **Datas** `AAAA-MM-DD` validadas no calendario real (`2026-02-30`, `2025-02-29`
  recusadas; bissexto correto); periodo de 1 a 366 dias, extremos incluidos; conta
  em UTC (sem depender do fuso do servidor); anos de 1900 a 2100 nos filtros.

### Paginacao

- Uma chamada le **1 pagina por padrao** (`paginas`, ate 5; ate 2.500 itens). Nao ha
  coleta integral. Cada pagina consome 1 das 60 req/min.
- O `cursor` e enviado **exatamente como veio**. Repetir um cursor ja usado e
  `cursor-loop` (erro), nao laco.
- `pagination.hasMore` e `true`/`false` quando a API informa, e **`null`** quando a
  resposta nao tem `meta` nem `links` - o VastaFlow nunca afirma que a lista acabou
  sem a API dizer.
- `links.next` presente e `meta.next_cursor` discordantes (ou um sem o outro quando
  ambos existem) e `pagination-inconsistent`.

### Taxa, tentativas e erros

- Limitador local: **50/min** (a API permite 60), **2 em voo**, espera de ate 20 s
  por vaga. Por processo - com varias instancias do backend a mesma chave receberia
  a soma.
- 429 respeita `Retry-After` (segundos ou data HTTP estrita; limitado a 24 h). Se
  couber em 15 s, espera e repete; senao devolve 429 e **pausa** o Plantae no
  processo. `X-RateLimit-Remaining: 0` tambem pausa a janela.
- No maximo **3 tentativas**, so para 429 curto, 5xx, timeout e falha de conexao,
  com backoff exponencial e jitter. 401/403/422/4xx/TLS/DNS **nao** repetem.
- Corpo de resposta limitado a 8 MiB.

| Falha | HTTP no VastaFlow | Codigo |
| --- | --- | --- |
| desligada / nao configurada | 424 | `PLANTAE_DISABLED` / `PLANTAE_NOT_CONFIGURED` |
| Plantae 401 | 424 | `PLANTAE_AUTH_REJECTED` |
| Plantae 403 | 424 | `PLANTAE_FORBIDDEN` |
| Plantae 422 | 424 | `PLANTAE_REJECTED_PARAMETERS` (so os **nomes** dos parametros) |
| 429 (Plantae ou local) | 429 | `PLANTAE_RATE_LIMITED` |
| timeout | 424 | `PLANTAE_TIMEOUT` |
| DNS / recusada / rede | 424 | `PLANTAE_UNREACHABLE` |
| TLS | 424 | `PLANTAE_TLS_ERROR` |
| 5xx / outro 4xx | 424 | `PLANTAE_UPSTREAM_ERROR` |
| resposta invalida, redirect, grande demais, cursor/paginacao incoerente | 424 | `PLANTAE_INVALID_RESPONSE` |
| filtro invalido (antes de qualquer chamada) | 400 | lista de problemas |

Por que **424/429 e nunca 5xx**: o filtro global troca todo 5xx por "Erro interno do
servidor", o que esconderia que o problema esta no Plantae. E nunca 401/403: seriam
lidos como falha do login do proprio usuario.

## 6. Premissas nao verificadas

Tudo abaixo foi **assumido a partir da colecao**. Itens marcados **[confirmado]** foram
vistos no ambiente real (secao 7.1); os demais continuam pendentes:

1. **Nome do escopo de cada rota** (a colecao so da dois, como exemplo). *Parcial:* a chave
   real traz 3 escopos e `accounts`/`people`/`legal-entities` responderam sem um escopo com
   esse nome - o mapeamento rota->escopo segue desconhecido.
2. Se cada endpoint devolve `links`/`meta`. **[confirmado]** para `accounts`,
   `legal-entities`, `people`, `entries`, `movements` e `account-statement` (neste, com
   `meta.saldo_anterior`/`saldo_final`). O codigo aceita as duas formas.
3. Nulabilidade real dos campos que nao aparecem `null` nos exemplos.
4. Escala real dos valores. **[confirmado]** em `entries`: ate 2 casas, e inteiros sem casas.
5. Formato e valores de `tipo_pessoa` (so `F`/`J` nos exemplos), de `numero_cheque`,
   `serie`, `numero` e `cfop` (numero ou texto - o codigo aceita ambos, como texto).
6. A forma de `razao_social` (em `entries`) e `fazenda` **[confirmado]**: objetos. Seguem
   pendentes `resposta_sefaz` e `cancelamento`.
7. Que o servidor aceita `campo%5B%5D=1` (a forma codificada de `campo[]=1`).
8. Formato de `Retry-After` e presenca de `X-RateLimit-*`.
9. Que a cadeia de certificados do host valida com os CAs padrao do Node. **[confirmado]**
10. Fuso de `dh_emissao`.

Se uma premissa falhar, o resultado e **erro explicito** (`PLANTAE_INVALID_RESPONSE`
com o caminho do campo no log), nunca dado aproximado.

## 7. Procedimento de homologacao real (NAO executado)

Pre-requisitos: token de homologacao **valido** (o token antigo pode ter sido exposto:
confirmar a validade e, se houver duvida, pedir a rotacao a Plantae), autorizacao
expressa do responsavel e um ADMIN humano.

1. Configurar **so localmente**, no `.env` (fora do Git):
   `PLANTAE_ENABLED=true`, `PLANTAE_BASE_URL=https://rc.plantae.agr.br/api/v1/external`,
   `PLANTAE_API_TOKEN=<chave>`. Subir o backend. **Nao colar a chave em chat/ticket.**
2. `GET /integrations/plantae/status` -> `READY`, `environment: homologation`.
3. **Primeiro e unico teste real inicial: `GET /integrations/plantae/me`.** Conferir
   `organizacao_id` e **anotar os escopos** (premissa 1).
4. Somente com autorizacao, consultas **pequenas** (`per_page=5`, uma pagina):
   `legal-entities` -> `accounts` -> `entries` (janela de poucos dias) -> `movements` ->
   `account-statement` (uma conta, janela curta) -> `issued-invoices` -> `people`
   (sem `busca` por CPF/CNPJ real).
5. Regras: no maximo ~15 requisicoes; **sem varredura**, sem exportacao, sem dump;
   registrar so **codigo de status e contagens**, nunca payload; nada de resposta em
   relatorio, chat ou ticket.
6. Conferir cada premissa da secao 6 e registrar o resultado.
7. Ao terminar: `PLANTAE_ENABLED=false`, remover o token do `.env` se nao for
   continuar, e rotacionar a chave se ela tiver sido exposta em algum momento.

### 7.1 Validacao real (Fases 4.1 a 4.4)

Feita a partir do computador do desenvolvedor (Node 24.14.1, nao do Docker), com a
chave de homologacao, **somente `GET`**, 1 tentativa por chamada, 1 pagina, `per_page=5`,
periodo `2026-09-01..2026-09-07`. Chamadas reais no total: `me` 2, `accounts` 3,
`legal-entities` 1, `people` 1, `entries` 1, `movements` 2, `account-statement` 1.
Nenhum dado de negocio foi registrado.

| Endpoint | Resultado | Observacao |
| --- | --- | --- |
| `me` | 200, contrato OK | 1a tentativa: **500 transitorio do Plantae**; a 2a, autorizada, deu 200. Escopos da chave: `financial-entries:read`, `financial-movements:read`, `account-statements:read` |
| `financial/accounts` | 200, 5 registros, contrato OK | autorizada **mesmo sem** escopo com esse nome na chave |
| `organization/legal-entities` | 200, 4 registros, contrato OK | ultima pagina (`next_cursor` null) |
| `people` | 200, 5 registros, contrato OK | idem accounts quanto ao escopo |
| `financial/entries` | 200, 5 registros, contrato OK | |
| `financial/movements` | 1a chamada: 200 **incompativel** (4.2); apos a correcao, 200, 5 registros, contrato OK (4.3) | a chave `saldo` **nao existe** nas linhas; ficou `null` = "nao informado" nos 5 registros. A amostra so tinha **debitos** (origens 1 e 4), nenhum conciliado |
| `financial/account-statement` | 200, **0 movimentos** (4.4): envelope OK | `data`+`links`+`meta` presentes; `saldo_anterior` e `saldo_final` presentes, decimais com 2 casas; ultima pagina. **Contrato das LINHAS (inclusive `saldo` por linha) NAO validado** |
| `fiscal/issued-invoices` | **NAO chamado** | a chave nao tem `issued-invoices:read` |

**Confirmado no real**
- DNS, HTTPS e a cadeia de certificados validam com os CAs padrao do Node, sem desativar nada.
- `links` e `meta` **vem** em `accounts`, `legal-entities`, `people` e `entries`, com
  `next_cursor` texto quando ha mais e `null` na ultima pagina; o `links.next` real passou
  na validacao estrita de host/caminho e e coerente com `meta.next_cursor`.
- Valores monetarios tem no maximo **2 casas** (nenhum com mais), **mas podem vir
  inteiros sem casas** (`1500`, `100`, `0`): a escala **nao e fixa**. Ficam como texto
  exato (`"1500"`, nunca `"1500.00"`).
- `razao_social` da parcela (`entries`) e um **objeto** (`razao_social_id`,
  `razao_social`, `inscricao_estadual`); `fazenda` (`legal-entities`) e um **objeto**
  (`fazenda_id`, `nome`). Continuam preservados sem interpretar (`PlantaeOpaque`).
- Nenhum campo fora do contrato apareceu nos 4 endpoints que passaram.
- Status de parcela vistos: 0 e 1 (a 2, substituida, **nao** apareceu na amostra).

**Corrigido**
- `financial/movements` (revalidado na Fase 4.3, sem diferencas adicionais): o exemplo da colecao reaproveita o esquema do extrato e mostra
  `saldo` por linha, mas a listagem real **nao o envia**. Na listagem, `saldo` ausente
  agora vira `null` ("nao informado"); no **extrato** a chave segue obrigatoria, porque
  ainda nao foi vista no real. O teste novo (dados ficticios) falha sem a correcao.

### 7.2 Pendencias para encerrar a Fase 4

Declaradas explicitamente; nenhuma foi omitida:

1. **Linhas do extrato nao validadas no real.** A conta testada voltou com zero
   movimentos em `2026-09-01..2026-09-07`. Falta um extrato com movimentos para
   confirmar o `saldo` por linha e o restante do contrato das linhas. Enquanto isso, o
   parser **exige** a chave `saldo` no extrato e falha de forma explicita se ela faltar
   (nunca inventa nem zera um saldo).
2. **NF-e (`issued-invoices`) nao exercitada**: a chave de homologacao nao possui o
   escopo `issued-invoices:read`. O contrato da NF-e e **somente** o da colecao.
3. **Organizacao da cliente nao confirmada.** O `/me` devolveu uma organizacao com id
   valido, mas nao ha referencia confiavel no projeto para compara-la. **Nao** se
   afirma que pertence a Rizola.
4. **Somente homologacao.** O endereco e a chave de producao nao existem no projeto
   (o host de producao nao esta no codigo, de proposito). Producao so entra apos a
   liberacao oficial da Plantae, por mudanca de codigo revisada.
5. **Nenhuma operacao de escrita**, e nenhuma e prevista: a API e somente leitura.
6. **Cenarios e filtros nao exercitados no real**: filtros de lista (`campo[]`,
   `%5B%5D`), `tipo`, `status`, `natureza`, `origem`, `conciliado`, `busca`; mais de uma
   pagina; creditos (`C`), movimentos com cheque ou contrapartida e parcelas
   substituidas (status 2); `Retry-After`, `X-RateLimit-*` e respostas 401/403/422 reais;
   o mapeamento rota->escopo; e a forma de `resposta_sefaz` e `cancelamento`.
7. **Egress a partir do Docker nao validado.** A chamada real saiu do computador do
   desenvolvedor, nao de um container do backend; a validacao no Docker foi feita com a
   integracao desligada ou sem token.
8. Linux/VPS e HTTPS publico (herdado das fases anteriores).

## 8. Cobertura dos requisitos da Rizola

> **Os requisitos abaixo sao os deduzidos do escopo informado para esta fase**, nao uma
> lista fornecida pela Rizola. Revisar com o responsavel. Legenda: **SUPPORTED** =
> existe na API, esta implementado e testado com mocks; **PARTIAL** = cobre com
> ressalva da propria API; **NOT SUPPORTED** = a API nao oferece; **PENDING
> VALIDATION** = depende de confirmacao no ambiente real. **Toda** linha SUPPORTED/
> PARTIAL tem tambem a validacao real pendente (secao 7).

| Requisito | Endpoint | Cobertura | Lacuna |
| --- | --- | --- | --- |
| Contas a pagar por vencimento | `entries` (`tipo=despesa`) | SUPPORTED | Valores na moeda do titulo; periodo <= 366 dias |
| Contas a receber por vencimento | `entries` (`tipo=receita`) | SUPPORTED | idem |
| Situacao da parcela (pendente/quitada/substituida) | `entries` (`status`) | SUPPORTED | Substituida != cancelada; parcela != pagamento |
| Saldo e total pago de uma parcela | `entries` | SUPPORTED | Moeda do titulo |
| Rateio por centro de custo / safra / categoria | `entries[].rateio` | SUPPORTED | - |
| Listar contas (caixa, banco, aplicacao) | `accounts` | SUPPORTED | Sem saldo |
| Extrato e saldo de uma conta | `account-statement` | SUPPORTED | Periodo <= 366 dias; nao e conciliacao |
| Entradas e saidas das contas | `movements` | **PARTIAL** | Exclui estornados e compras no cartao; nao e "toda" a movimentacao |
| Ver se um movimento esta conciliado | `movements` (`conciliado`) | SUPPORTED | Somente leitura |
| NF-e emitidas | `issued-invoices` | **PARTIAL** | So modelo 55, autorizadas/canceladas, de producao; sem rejeitadas/denegadas/em digitacao |
| Buscar cliente/fornecedor por nome ou CPF/CNPJ | `people` (`busca`) | SUPPORTED | Dado pessoal; termo de busca nunca e logado |
| Razoes sociais da organizacao | `legal-entities` | SUPPORTED | - |
| Conferir a integracao e seus escopos | `me` | SUPPORTED | Escopo de cada rota: **PENDING VALIDATION** |
| Notas fiscais **recebidas** (de terceiros) | - | NOT SUPPORTED | A API lista as **emitidas** (`operacao=entrada` e nota de entrada emitida pela propria organizacao) |
| Emitir NFS-e | - | NOT SUPPORTED | Nao existe na API do Plantae; e operacao fiscal que exigiria confirmacao explicita |
| Baixar XML / DANFE / DANFSe | - | NOT SUPPORTED | "A API nao entrega XML nem DANFE" |
| Lancar pagamento, dar baixa, criar lancamento | - | NOT SUPPORTED | API somente leitura |
| Conciliar extrato automaticamente | - | NOT SUPPORTED | Nao existe na API |
| Criar/alterar pessoas, contas, razoes sociais | - | NOT SUPPORTED | API somente leitura |
| Perguntar por WhatsApp/Telegram | - | NOT IMPLEMENTED | Exige fase propria: resolver o usuario de origem e autorizar; o n8n nao tem acesso |
| Dados sempre sincronizados / historico local | - | NOT SUPPORTED | Consulta sob demanda; sem copia local, por decisao |

## 9. Testes

- Unitarios (`src/modules/integrations/plantae/*.spec.ts`): datas, configuracao,
  parse de JSON (precisao), parsers de resposta, filtros, limitador, cliente HTTP
  (cabecalho, redirect, 401/403/422/429/5xx, timeout, DNS, TLS, corpo grande,
  vazamento), servico (cursor, laco, `links.next`), provider, mapeamento de erros,
  variaveis de ambiente e **arquitetura** (um `fetch`, um uso do token, so GET, sem
  `process.env`, sem modulo de negocio).
- E2E (`test/plantae*.e2e-spec.ts`): aplicacao completa, `fetch` simulado -
  autorizacao por perfil, token de servico do n8n recusado, os 8 endpoints, filtros,
  erros, auditoria, vazamento em logs e respostas, estados desligado e nao
  configurado.
- Fixtures sanitizadas (`test/support/plantae-fixtures.ts`): dados ficticios; nenhum
  valor da colecao real.
- **Nao ha teste automatizado contra o Plantae**, de proposito. A validacao de TLS e
  coberta por classificacao de erro simulada; o handshake real contra
  `rc.plantae.agr.br` esta na lista de pendencias.

## 10. Fase 6 - prontidao do `/contas_pagar` no Telegram (preparacao; NADA foi consultado)

> **Estado de prontidao para consulta real: PARTIAL / BLOCKED** (ver 10.1). Nesta fase **nenhuma** chamada ao
> Plantae foi feita, nenhuma flag foi ligada e nenhum servico foi reiniciado. Tudo abaixo e preparacao,
> codigo e testes (com `fetch` simulado e fixtures ficticias).

### 10.1 Semaforo

| Condicao | Estado |
| --- | --- |
| Organizacao da chave = a da cliente | **PENDING VALIDATION (bloqueante)** - ver 10.2 |
| Escopo para `financial/entries` | **Comprovado na homologacao** (Fase 4.x: 200 com dados); o *nome* do escopo da rota segue nao documentado. A chave tem 3 escopos (`financial-entries:read`, `financial-movements:read`, `account-statements:read`); nenhum adicional foi necessario |
| Credencial Plantae no ambiente local | **Ausente** (nenhuma `PLANTAE_API_TOKEN`; nenhum arquivo de credencial local) |
| Usuario humano ADMIN | **Nao existe** (1 usuario: OPERADOR). Caminho legitimo existe e **nao foi executado** - 10.5 |
| Vinculo Telegram do ADMIN | Pendente (depende do ADMIN) |
| `PLANTAE_ENABLED` / `PLANTAE_CHAT_COMMANDS_ENABLED` / `PLANTAE_ORGANIZATION_CONFIRMED` | todos `false` |
| Semantica de valor/saldo de parcela parcial | **Pendente** (10.7); o chat so *sinaliza* |

### 10.2 Como confirmar a organizacao (procedimento)

O Bearer define a organizacao e `X-Tenant-Id` nao e usado; um `200` em `GET /me` so prova que a chave e valida.
Para atestar que a organizacao e a da cliente, e preciso uma **referencia independente**:

1. **Fonte A** - dado que a *cliente* informou por canal proprio (razao social e/ou identificador da organizacao no
   Plantae, conforme a tela dela), **ou** **fonte B** - confirmacao *formal e escrita* da Plantae associando a chave (ou o
   `organizacao_id`) a cliente. Resposta informal de fornecedor, ou o fato de a chave ter chegado por conversa, **nao** vale.
2. Com autorizacao especifica, **uma** chamada `GET /integrations/plantae/me` (e, se preciso, `organization/legal-entities`) e
   comparacao **local** com a referencia. Nao copiar identificadores fiscais/pessoais para relatorios, tickets ou Git.
3. Registrar **quem conferiu, quando e contra qual fonte** no registro da mudanca (fora do repositorio).
4. So entao colocar `PLANTAE_ORGANIZATION_CONFIRMED=true` no `.env` privado. **E um atestado do operador**: o sistema nao
   tem como verificar sozinho. Se a chave for trocada ou rotacionada, o atestado deve ser refeito.

Fail-closed no codigo: sem o atestado, `/contas_pagar` responde "bloqueada" **sem chamar o Plantae**, e o **boot e recusado**
se `PLANTAE_ENABLED=true` e `PLANTAE_CHAT_COMMANDS_ENABLED=true` sem ele.

### 10.3 Contrato do comando `/contas_pagar` (decisoes e por que)

| Decisao | Regra |
| --- | --- |
| Fonte | `GET /financial/entries?tipo=despesa&status[]=0&data_inicio=..&data_fim=..&per_page=5` - **somente leitura**, **uma pagina** |
| Pendente | `status.codigo == 0`. O filtro e aplicado **tambem no backend**: se o Plantae devolver quitada (1) ou **substituida (2)**, elas sao descartadas e o fato e informado ("N item(ns) fora do status pendente foram ignorados") |
| Periodo | sem argumentos: hoje (Brasilia) a +7 dias; ou duas datas `AAAA-MM-DD`, ate 31 dias; invalido = uso, **sem consulta** |
| Valor | o **valor da parcela**, na **moeda do titulo**, formatado a partir do **texto decimal** (sem `float`, sem arredondar, **sem somar**, **sem converter moeda**) |
| Pagamento parcial | `total_pago` diferente de zero => linha marcada **"JA TEVE PAGAMENTO PARCIAL (confira no Plantae)"**. **Nao** se calcula nem se exibe saldo: a semantica de `saldo_atual` nao e documentada |
| Itens | no maximo **5**; se o Plantae devolver mais, mostra 5 e avisa que ha mais (nunca varre a organizacao) |
| Homologacao | **toda** resposta comeca por "HOMOLOGACAO - dados de teste do Plantae, nao sao os dados definitivos da empresa." |
| Favorecido | **oculto por padrao** (`PLANTAE_CHAT_SHOW_PAYEE_NAME=false`); a linha traz a referencia curta `ref <parcela_id>`. Ligado: nome abreviado (28 car.), sem quebra de linha |
| Nunca sai | CPF/CNPJ, dados bancarios, observacao, descricao, documento, rateio, payload bruto |
| Erros | frase fixa por categoria; **nenhum valor inventado**; 429/5xx/timeout nao geram numeros |

### 10.4 Portoes, na ordem em que sao checados

1. Remetente **vinculado**, vinculo e usuario **ativos** (resolvidos do id do Telegram assinado; o `username` nunca e prova).
2. **RBAC** do Command Engine: `plantae:read` (so ADMIN por padrao) - o OPERADOR e negado **antes** do handler, sem Plantae.
3. `PLANTAE_CHAT_COMMANDS_ENABLED=true`.
4. `PLANTAE_ORGANIZATION_CONFIRMED=true`.
5. `PLANTAE_ENABLED=true` (e a chave/URL de homologacao validas).
6. Periodo valido; **3 consultas/min por pessoa**; limite do Telegram de **10 msg/min por remetente**; limitador do Plantae
   (60/min por chave, conservador); **uma pagina**; prazo de **20 s**; sem retry automatico.

Auditoria (`PLANTAE_QUERIED`, ator = a **pessoa**; `CHANNEL_MESSAGE` registra `principal`/`servicoId` do servico):
`metadados.detalhe` distingue `ok`, `vazio`, `comando_desligado`, `organizacao_nao_confirmada`, `integracao_desligada`,
`nao_configurado`, `credencial_recusada`, `limite_fornecedor`, `limite_pessoa`, `parametros_rejeitados`, `erro_fornecedor`,
`prazo_excedido`, `periodo_invalido`; **acesso negado** aparece como `DENIED` no `CHANNEL_MESSAGE`. Nenhum valor, nome, documento, token ou texto.

### 10.5 Procedimento para um usuario ADMIN de teste (auditado; NAO executado)

Modelo existente: ADMIN ignora a checagem de permissoes; **so um ADMIN cria ou promove ADMIN**; o cadastro publico
(`/auth/register`) cria `USUARIO` e e fechado em producao; **nao ha** ferramenta que crie ADMIN (o CLI local cria **so OPERADOR**, de proposito).
O unico caminho legitimo sem ADMIN previo e o **bootstrap do administrador inicial**:

1. O responsavel define `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (e `SEED_ADMIN_NAME`) **manualmente** no `.env` privado.
2. O backend e recriado (`docker compose up -d --no-deps backend`). O `SeedService` cria o ADMIN **uma vez** (idempotente; nao altera usuarios
   existentes). **Impacto:** o bot fica sem consumidor ~1 min; mensagens enviadas nesse intervalo sao entregues na volta se tiverem menos de
   10 min. **Exige autorizacao explicita** (servico ativo).
3. Depois do bootstrap, remover `SEED_ADMIN_*` do `.env` (a senha nao deve ficar em arquivo).
4. **Vinculo:** o par `(canal, id externo)` e **unico**: um mesmo Telegram nao pode estar vinculado ao OPERADOR e ao ADMIN ao mesmo tempo.
   Opcao A (preferida): vincular o ADMIN a uma **segunda conta** de Telegram do responsavel (via solicitacao administrativa + `/vincular`).
   Opcao B: revogar o vinculo do OPERADOR (`DELETE /users/:id/external-identities/:linkId`) e vincular o ADMIN ao mesmo Telegram.
5. O perfil do OPERADOR existente **nao e alterado**.

### 10.6 Plano de teste financeiro controlado (para aprovacao; NAO executado)

Pre-condicoes (todas): organizacao confirmada (10.2); credencial de **homologacao** em arquivo privado, colada pelo proprio responsavel;
ADMIN vinculado (10.5); stack saudavel; autorizacao explicita para (a) reiniciar o backend, (b) **uma** chamada a `/me`, (c) ligar as flags.
Passos: (1) `PLANTAE_BASE_URL` de homologacao, `PLANTAE_API_TOKEN`, `PLANTAE_ENABLED=true`, `PLANTAE_ORGANIZATION_CONFIRMED=true`,
`PLANTAE_CHAT_COMMANDS_ENABLED=true`; recriar so o backend; (2) OPERADOR envia `/contas_pagar` -> **negado, Plantae nao chamado**;
(3) ADMIN envia `/contas_pagar` (periodo curto) -> resposta com o aviso de **HOMOLOGACAO**, <= 5 itens, sem CPF/CNPJ/nome; (4) conferir
os valores na tela do Plantae (homologacao); (5) auditoria `PLANTAE_QUERIED` com `detalhe=ok`; (6) **conferir o PostgreSQL do n8n**: o texto da
resposta financeira nao deve estar em `execution_data` (so o corpo do pedido, transitoriamente); (7) logs sem token/valores.
Criterios de parada: qualquer valor divergente, dado pessoal na resposta, chamada fora de homologacao ou erro inesperado => desligar as flags.
Rollback: `PLANTAE_CHAT_COMMANDS_ENABLED=false` (e/ou `PLANTAE_ENABLED=false`), recriar so o backend; revogar a chave na Plantae se vazou.

### 10.7 Pendencias que continuam

- Semantica de `valor` x `saldo_atual` x `total_pago` em parcela **parcialmente paga** (por isso so se sinaliza).
- Parcela **substituida** (status 2) nunca apareceu na amostra real; o tratamento e defensivo e testado so com fixtures.
- Erros reais 401/403/429/5xx do Plantae nunca foram observados; testados com simulacao.
- Resposta financeira passa pelo n8n em claro (trafego interno) e pelos servidores do Telegram (nao ponta a ponta).
- Politica de divulgacao do favorecido e decisao do negocio (hoje: oculto).
