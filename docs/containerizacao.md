# Containerizacao - estado da validacao

> **Leia isto antes de confiar em qualquer arquivo de infraestrutura deste
> repositorio.**
>
> Data: 2026-10-07. Fase 2, parcial.

A maquina onde o projeto e desenvolvido **nao tem runtime de container**.
Verificado: `docker` e `docker compose` ausentes no PATH do Bash e do
PowerShell; nenhum diretorio de instalacao do Docker Desktop; nenhum servico
Windows registrado; `podman` e `nerdctl` ausentes; WSL presente mas sem
distribuicao instalada.

Consequencia direta: **os arquivos de Docker e Nginx deste repositorio nunca
foram construidos nem executados.** Eles foram escritos a partir de evidencia
do codigo e da documentacao oficial, mas nao tem prova de execucao.

## O que ESTA validado

Tudo nesta secao foi exercitado de verdade, contra um **MySQL 8.4.9 real**
rodando localmente (sem Docker, usando os binarios oficiais que o projeto ja
utilizava para validar migrations).

| Propriedade | Como foi provado |
| ----------- | ---------------- |
| Handshake TLS real entre a aplicacao e o MySQL | `TLSv1.3` / `TLS_AES_256_GCM_SHA384`, com `require_secure_transport=ON` no servidor e query real executada |
| A cadeia do certificado e validada | CA propria; o servidor so e aceito quando assinado por ela |
| **A identidade do servidor e validada** | Certificado assinado pela **mesma CA confiavel**, mas com SAN `wrong-mysql-name`, conectando em `localhost`: **conexao RECUSADA** com `HANDSHAKE_SSL_ERROR` - `Hostname/IP does not match certificate's altnames` |
| O problema corrigido na Fase 1 era real | O **mesmo** servidor de SAN errado foi **ACEITO** quando `verifyIdentity` foi removido do objeto `ssl`. Com ele, recusado. Lado a lado, no mesmo servidor |
| Restauracao apos o teste negativo | Certificado correto recolocado; conexao volta a funcionar |
| CA ausente e recusada | Recusa na montagem da configuracao, pelo codigo de producao |
| `DATABASE_SSL=false` em producao e recusado | Pela validacao de ambiente (boot) **e** pelo servidor (`ER_SECURE_TRANSPORT_REQUIRED`) |
| Host IP em producao com TLS e recusado | Pela validacao de ambiente, porque com IP o driver nao envia `servername` e a conferencia de hostname seria saltada em silencio |
| `DATABASE_SSL_CA_FILE` funciona | Handshake completo com a CA vinda de arquivo, nao de conteudo inline |
| Arquivo de CA inexistente e recusado | Mensagem nomeia o caminho, nunca o conteudo |
| As duas formas de CA ao mesmo tempo sao recusadas | Sem precedencia, por decisao - configuracao ambigua nao sobe |
| `scripts/gerar-tls-dev.sh` | Executado; gera CA e certificado com SAN correto, cadeia confere, e o material gerado foi usado no handshake acima |
| Separacao do material TLS | O backend recebe **somente** `ca.pem`. Chave da CA e chave do servidor ficam fora dele |
| O codigo exercitado e o de producao | Os testes importam `buildDataSourceOptions` do `dist/` compilado - a mesma funcao que o `DatabaseModule` e o CLI de migrations usam. Nenhuma opcao `ssl` foi montada a mao |

Um achado de passagem, que confirma em pratica uma decisao da Fase 1: o
certificado que o MySQL **auto-gera** no datadir tem CN
`MySQL_Server_8.4.9_Auto_Generated_Server_Certificate` - nao o hostname. Ele
jamais passaria na conferencia de identidade, o que e exatamente a razao de a
estrategia de "reusar a CA auto-gerada do container" ter sido rejeitada.

## O que NAO esta validado

Nada aqui tem prova de execucao. Nao confie sem construir e rodar.

| Arquivo | Estado |
| ------- | ------ |
| `backend/Dockerfile` | **NAO CONSTRUIDO** |
| `frontend/Dockerfile` | **NAO CONSTRUIDO** |
| `frontend/nginx/vastaflow.conf` | **NAO EXECUTADO** |
| `frontend/nginx/seguranca.conf` | **NAO EXECUTADO** |
| `docker-compose.production.yml` | **NAO EXECUTADO**. Apenas a sintaxe YAML e a estrutura foram conferidas |

E, por consequencia, nao estao provados:

- build das imagens, e em particular se `bcrypt` e `oracledb` carregam na imagem
  `bookworm-slim` (a escolha por glibc tem base no conteudo dos pacotes
  instalados, mas nao foi exercitada);
- isolamento de rede e nao-publicacao das portas em execucao;
- a ordenacao `mysql healthy -> migrate -> backend` pelo `depends_on`;
- o comportamento quando a migration falha;
- os healthchecks (em especial o do backend, que usa o `fetch` do proprio Node,
  e o do MySQL por socket Unix);
- persistencia dos volumes entre recriacoes de container;
- qualquer comportamento do Nginx: fallback do SPA, cabecalhos, CSP contra o
  frontend real, rate limit, `client_max_body_size`, `proxy_buffering off` nas
  rotas de streaming;
- o IP real do cliente chegando a auditoria atraves do proxy;
- o TLS com o hostname `mysql` (o teste usou `localhost`, porque sem Docker
  aquele nome nao resolve - a propriedade provada e a mesma, o nome e que muda);
- qualquer smoke test passando pelo Nginx.

### HTTPS publico

**PENDENTE PARA A FASE DE DEPLOY.** Nao ha dominio, DNS nem certificado
publico, e nao foi usado Let's Encrypt. O TLS crucial desta etapa e o interno
(aplicacao -> MySQL), e esse esta provado. `HSTS` esta deliberadamente ausente
da configuracao do Nginx: em HTTP local ele e pior que inutil, porque o
navegador passaria a recusar HTTP para o host e guardaria isso. Entra junto com
o certificado real.

## Como validar quando houver Docker

```bash
# 1. material TLS local (CA + certificado com SAN = nome do servico)
./scripts/gerar-tls-dev.sh mysql

# 2. ambiente - NUNCA com segredo de producao
cp .env.example .env     # preencher DATABASE_*, JWT_SECRET, SEED_ADMIN_*

# 3. build
docker compose -f docker-compose.production.yml build

# 4. subir
docker compose -f docker-compose.production.yml up -d

# 5. conferir o que a Fase 2 exige
docker compose -f docker-compose.production.yml ps          # portas publicadas
docker network inspect vastaflow_app-data                   # mysql isolado
docker compose -f docker-compose.production.yml logs migrate # exit 0
```

O `DATABASE_HOST` do compose e `mysql`, e o certificado precisa trazer esse nome
no SAN - e por isso que o script recebe o hostname como argumento. Divergencia
entre os dois faz a conexao ser recusada, e a mensagem diz exatamente isso.

## Limites conhecidos do ambiente local vs KVM 4

Os limites de recurso no `docker-compose.production.yml` sao para **validacao
local**, nao para a VPS. Proposta para a Hostinger KVM 4 (4 vCPU, 16 GB),
a aplicar na fase de deploy:

| Servico | Local (atual) | Proposta KVM 4 |
| ------- | ------------- | -------------- |
| mysql | 1,0 CPU / 1 GB · `innodb_buffer_pool_size=256M` | 2,0 CPU / 3 GB · buffer pool 1-2 GB |
| backend | 1,0 CPU / 768 MB | 1,0-1,5 CPU / 1 GB |
| nginx | 0,5 CPU / 128 MB | 0,5 CPU / 256 MB |
| migrate | 0,5 CPU / 512 MB | igual (one-shot) |

O backend tem limite folgado por causa do upload: o `multer` bufferiza o arquivo
inteiro na memoria antes de entregar ao storage. Com `DOCUMENT_MAX_FILE_SIZE` em
10 MB o risco e pequeno; se esse valor subir, o limite do container e a rede de
protecao.

Rotacao de log: `json-file` com `max-size=10m` e `max-file=3` em todos os
servicos, ou seja ~30 MB por servico. Sem isso o log cresce sem limite e enche o
disco da VPS.
