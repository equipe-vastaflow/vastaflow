# ADR 0003 - Topologia de producao: VPS unica com Docker Compose

- **Status:** aceito
- **Data:** 2026-10-07
- **Decisores:** equipe VastaFlow

## Contexto

O VastaFlow precisa de um ambiente de producao. Duas direcoes foram avaliadas
em detalhe e descartadas antes desta.

### AWS (Lightsail + RDS + S3) - descartada

Foi especificada por completo e **nunca implementada**. Nenhum codigo do
repositorio referencia AWS: zero SDK, zero Terraform, zero mencao a RDS ou S3
fora de documentacao. Abandonar essa direcao nao exigiu remover uma linha.

O motivo do descarte e de proporcao: tres servicos gerenciados, com a
administracao e o custo que vem com eles, para uma aplicacao que roda em um
servidor. A complexidade operacional nao se pagava nesta etapa.

### n8n Cloud como nucleo - descartada

A investigacao encontrou tres impedimentos tecnicos duros, nao questoes de
preferencia:

1. **O Code node do n8n Cloud nao importa modulos npm** (so `crypto` e
   `moment`). Isso impede verificar os hashes `bcrypt` existentes em
   `users.senha_hash` - obrigaria a redefinir a senha de todos os usuarios - e
   impede reproduzir o export XLSX, que depende de ExcelJS para streaming,
   formato monetario, cabecalho congelado e data como serial.
2. **Nao ha transacao nem lock pessimista.** O modulo financeiro usa
   `SELECT ... FOR UPDATE` e transacoes para mudanca de status; nao existe
   equivalente.
3. **A cobranca e por execucao de workflow.** Uma execucao e uma rodada do
   workflow inteiro, independentemente do numero de passos - o que torna o n8n
   barato para conversas e proibitivo para uma API REST. Com as 41 rotas HTTP
   atuais expostas como webhooks, o cenario de cinco usuarios ja estouraria o
   plano Pro.

A conclusao nao foi "n8n nao serve", e sim: o n8n e excelente como camada de
canais e orquestracao, e inadequado como sistema de registro.

## Decisao

Hospedar o VastaFlow em uma **unica Hostinger VPS KVM 4** (4 vCPU, 16 GB RAM,
200 GB NVMe), com **Docker Compose** orquestrando:

| Componente | Papel |
| ---------- | ----- |
| **Nginx** | Unico ponto publico. Termina TLS e serve o build estatico do React |
| **React/Vite** | Interface administrativa. Build estatico, sem container de runtime proprio |
| **NestJS** | API de dominio: autenticacao, RBAC, regras de negocio, persistencia, auditoria, documentos, operacoes criticas |
| **MySQL** | Banco transacional do VastaFlow |
| **n8n self-hosted** | Orquestracao, automacoes, canais (Telegram, WhatsApp), agendamentos, integracoes |
| **PostgreSQL** | Banco **interno e exclusivo do n8n** |
| **Document storage** | Volume local persistente, atras da `StoragePort` ja existente |
| **Backup externo** | Obrigatorio. Fora da VPS, cifrado, com restauracao testada |

### O que fica explicitamente de fora desta fase

- **AWS nao sera utilizada.** Nem Lightsail, nem EC2, nem ECS.
- **RDS nao sera utilizado.** O MySQL roda em container na propria VPS.
- **S3 nao e o storage inicial.** Os documentos ficam em volume local, atras da
  abstracao que ja existe. A troca futura e um adapter novo, sem tocar no
  dominio.
- **n8n Cloud nao sera utilizado.**

### Invariantes da topologia

Estas nao sao recomendacoes, sao propriedades que a infraestrutura deve
garantir:

1. **O n8n nao acessa o MySQL diretamente** - nem com credencial. Redes Docker
   separadas fazem disso uma propriedade da rede, nao da disciplina de quem
   constroi o workflow.
2. **O n8n consome o NestJS por API**, com autenticacao servico-a-servico
   propria (ver a secao conceitual abaixo).
3. **O NestJS continua responsavel** por dominio, seguranca e persistencia.
4. **O n8n e responsavel** por orquestracao, automacoes e canais.
5. **Nenhum banco e publicado.** MySQL e PostgreSQL existem apenas na rede
   interna; so as portas 80 e 443 do Nginx ficam publicas.
6. **Existe exatamente UM proxy reverso.** `app.setup.ts` fixa
   `trust proxy = 1`. Se um dia entrar outro proxy na frente (uma CDN, por
   exemplo), esse valor tem de virar 2 - senao o IP registrado na auditoria
   passa a ser falsificavel pelo cliente.

### Decisao conceitual: SERVICE PRINCIPAL != BUSINESS ACTOR

Registrada aqui porque vale para toda integracao futura (n8n, WhatsApp,
Telegram) e porque confundir as duas coisas corromperia a trilha de auditoria.

São **duas identidades distintas** numa mesma requisicao:

- **Service principal** - *qual sistema* esta chamando a API. No fluxo previsto,
  o n8n. E o sujeito da **autenticacao**.
- **Business actor** - *qual pessoa* originou a solicitacao. No fluxo
  `usuario -> WhatsApp -> n8n -> NestJS`, e o usuario VastaFlow vinculado
  aquela identidade externa. E o sujeito da **acao de negocio**.

Consequencias:

- A auditoria **nao** deve registrar o n8n como autor humano de acoes que uma
  pessoa originou. Quem lancou uma despesa pelo WhatsApp foi a pessoa, com o
  n8n apenas como transporte.
- Um fluxo pode ter service principal **sem** business actor (uma sincronizacao
  agendada, por exemplo). Nesse caso nao existe autor humano, e inventar um
  seria pior que registrar a ausencia.
- O service principal **nao** se autentica com login e senha de funcionario,
  **nao** guarda JWT de usuario de forma permanente e **nao** se passa por
  pessoa.
- A resolucao do business actor continua sendo responsabilidade do NestJS, a
  partir de `external_identity_links`. O n8n nunca decide quem e o usuario.

O contrato tecnico esta em
[`docs/autenticacao-servico-a-servico.md`](../autenticacao-servico-a-servico.md).
A implementacao e de fase posterior.

## Motivo

O codigo ja foi escrito para esta topologia, e isso nao e coincidencia:
`app.setup.ts` configura `trust proxy = 1` com o comentario de que corresponde a
"um unico proxy reverso (Nginx) na frente do Node"; o `ConfigModule` documenta
que em producao as variaveis vem do orquestrador e o arquivo `.env` nao existe;
a `StoragePort` isola o filesystem num unico arquivo. A lacuna era de
infraestrutura, nao de arquitetura.

A divisao de responsabilidades tambem ja esta construida: o NestJS detem as 14
permissoes, a auditoria, as transacoes e as regras financeiras; o n8n entra
fazendo o que faz melhor, sem herdar nada disso.

**PostgreSQL para o n8n nao e preferencia.** A documentacao oficial do n8n
self-hosted suporta apenas SQLite e PostgreSQL - MySQL nao e opcao, logo
reaproveitar o banco do VastaFlow e tecnicamente impossivel. Entre os dois
suportados, PostgreSQL foi escolhido por duas razoes: `pg_dump` produz backup
consistente com o servico no ar, enquanto copiar um arquivo SQLite ativo pode
gerar copia inconsistente; e migrar de SQLite para PostgreSQL depois atravessa a
chave de criptografia das credenciais, que e a operacao mais delicada do n8n.
Dez linhas de compose agora evitam uma migracao arriscada depois.

**O build estatico do React vai dentro da imagem do Nginx**, em vez de um
container de runtime proprio. Um container separado permitiria redeploy
independente, mas abre uma janela em que o `index.html` novo referencia assets
com hash antigo. Imagem unica torna o deploy atomico.

**Tres subdominios** (`app.`, `api.`, `n8n.`) em vez de caminhos num dominio
unico. O motivo decisivo nao e organizacao: o editor do n8n da acesso a todas as
credenciais do sistema, e o frontend guarda o JWT em `localStorage`. Em origens
separadas, um XSS no editor nao alcanca o token da aplicacao.

## Consequencias

### Positivas

- Reaproveita integralmente a camada de dominio, as migrations e a suite de
  testes. Nenhuma regra de negocio e reescrita.
- Elimina a AWS sem remover codigo.
- Custo de infraestrutura previsivel e concentrado.
- O deploy e reproduzivel por um operador, com procedimento escrito.
- Os recursos da KVM 4 sao folgados para a carga prevista. Capacidade nao e o
  limite desta topologia.

### Negativas

**A VPS e um unico ponto de falha, e isso precisa ser dito sem rodeio.** Perder
o servidor e perder, ao mesmo tempo: aplicacao, banco, automacoes e documentos.

**Backup armazenado somente dentro da propria VPS nao e backup.** Ele nao
protege contra: perda do servidor, comprometimento com acesso root (que apaga ou
cifra as copias junto), erro humano - `docker compose down -v` apaga volumes, e
o compose de desenvolvimento documenta esse comando -, corrupcao silenciosa de
disco, ou incidente de regiao. Dai o backup externo ser **requisito de go-live**,
nao melhoria.

Outras consequencias aceitas:

- Quem pertence ao grupo `docker` na VPS le todos os segredos. E inerente a esta
  topologia e precisa ser aceito explicitamente, nao ignorado.
- Nao ha escalonamento horizontal sem redesenho.
- Dois bancos (MySQL e PostgreSQL) dobram o procedimento de backup e
  restauracao, com ferramentas diferentes.
- O TLS entre a aplicacao e o MySQL depende de uma CA propria, operada por nos,
  com renovacao manual do certificado do servidor. Certificado expirado
  significa indisponibilidade total, porque a verificacao e obrigatoria.
- A chave de criptografia do n8n passa a ser um item de recuperacao de primeira
  classe: sem ela, nem um backup intacto do banco recupera as credenciais das
  integracoes.

### Escopo preservado

- **A Documents Foundation permanece como esta.** Nada de recriar, nada de
  migrar para S3 nesta fase. A `StoragePort`, o `LocalStorageAdapter`, a entidade
  e as protecoes contra travessia de diretorio continuam intocados.
- **Plantae depende de dependencia externa**: documentacao e API Key serao
  fornecidas pelo TI do Plantae. Nenhum endpoint e inventado antes disso.
- **NFS-e e fase posterior**, independente do Plantae, pela integracao oficial
  com NFS-e Nacional/Gov.br. Exigira certificado digital ICP-Brasil, que nao
  fica no repositorio nem no cofre do n8n.

## Estrategia de evolucao

1. **Mitigar o ponto unico de falha** com backup externo testado e restauracao
   ensaiada. E o primeiro patamar, nao o ultimo.
2. **Trocar o storage local** por um adapter compativel com S3 quando o volume
   de documentos justificar. Aqui a `StoragePort` se paga: o contrato de teste
   compartilhado valida um adapter novo sem um unico caso de teste adicional, e
   existem provedores compativeis com a API S3 que nao sao AWS.
3. **Separar o banco** em instancia propria quando a carga pedir.
4. **Avaliar duas VPS com failover** somente se a disponibilidade se tornar
   requisito contratual - e nunca antes de o backup externo estar provado.

## Pendencia

**Validado em 2026-10-08** (Docker Desktop, Engine 29.8.2): o handshake TLS real
entre a aplicacao e o MySQL 8.4.9, com `require_secure_transport=ON`, usando o
hostname `mysql` e a CA por arquivo montado; a recusa de um certificado assinado
pela CA confiavel mas com SAN errado (`ERR_TLS_CERT_ALTNAME_INVALID`, sem falha
de cadeia); e a aceitacao desse mesmo servidor quando `verifyIdentity` e
removido, o que prova que a opcao e o que faz a diferenca. Detalhes, comandos e
as correcoes que a execucao forcou em `docs/containerizacao.md`.

**Ainda NAO validado**, e continua sendo condicao do deploy:

- a VPS Linux (kernel, permissoes reais de bind mount - a chave do servidor
  precisa de `chown 999:999`, o que o Windows esconde);
- o HTTPS publico (dominio, DNS e certificado reais; o webhook da Meta rejeita
  certificado autoassinado);
- o IP externo real do cliente na auditoria (no Docker Desktop a conexao do host
  passa por NAT e chega como o gateway da bridge);
- o backup externo e a restauracao.

## Atualizacao - Fase 3 (2026-10-08)

n8n 2.43.1 e seu PostgreSQL 18.6 entraram no Compose, e a autenticacao
servico-a-servico foi implementada e validada **localmente** (ver
`docs/containerizacao.md` e `docs/autenticacao-servico-a-servico.md`). As
invariantes acima foram verificadas por execucao: o n8n nao resolve nem alcanca o
MySQL, o editor so escuta em `127.0.0.1`, e nao existe usuario "N8N" na tabela de
usuarios. Continuam **nao validados**: a VPS Linux, o HTTPS publico e os tres
subdominios. Nenhum workflow de negocio nem canal foi criado.
