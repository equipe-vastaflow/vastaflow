# Deploy 09/11/2026 - painel Plantae e `/contas_receber`

Registro tecnico do deploy seletivo que levou para producao o painel Plantae (cinco abas), o acesso por `plantae:read`
com mascaramento e `no-store`, e o comando `/contas_receber`. Sem segredos neste documento: so caminhos, hashes de
codigo-fonte e resultados.

| Campo | Valor |
| --- | --- |
| Data | 09/11/2026 |
| Ambiente | VPS de producao (`/opt/vastaflow`, sem `.git`), host `vastaflow.duckdns.org` |
| Tipo | Deploy **seletivo** de 19 arquivos de runtime (a VPS nao tem `.git`; o `HEAD` local tem commits que NAO vao para producao, como NFS-e e WhatsApp Baileys) |
| Base local | `HEAD b2006d9` + alteracoes locais **nao commitadas** (o pacote saiu do diretorio de trabalho) |
| Migrations | **Nenhuma** (sem entidade nova, sem codigo de permissao novo; `plantae:read` do GESTOR ja estava no banco) |
| Servicos reconstruidos | `backend` + `migrate` (juntos) e `nginx`. MySQL, PostgreSQL e n8n nao foram recriados |
| Workflow do n8n | Inalterado (repasse generico) |
| Variaveis de ambiente | Inalteradas (`PLANTAE_CHAT_SHOW_PAYEE_NAME=false` confirmado) |

## 1. Pacote

Gerado e validado localmente em `C:\Users\Pedro\vastaflow-deploy\plantae-painel\`:

| Arquivo | Conteudo |
| --- | --- |
| `plantae-painel.tar` | 19 arquivos com caminhos relativos a `/opt/vastaflow`, dono `0:0`, modo `644`; 184.320 bytes; SHA-256 `91a1eccdcc8c7fce61657cdbd4a4e6c3f7ec22dc7dce61762a02779d01127cbc` |
| `pre.sha256` | Estado obrigatorio da VPS ANTES da copia (8 arquivos existentes) |
| `pos.sha256` | Estado esperado DEPOIS da copia (19 arquivos) |
| `novos.txt` | 11 arquivos que nao podiam existir na VPS antes |
| `manifesto.txt` | Lista por backend/frontend, base e hash do TAR |

Validacoes do pacote: 19 entradas, sem duplicatas nem extras; extraido em pasta temporaria com 19/19 hashes OK; so LF;
nenhum padrao de token ou chave; `client.ts` mantem `changePassword`; `App.tsx` mantem `/privacidade`.

**Fora do pacote, de proposito:** testes (`*.spec.ts`, `test/`, `*.test.tsx`, `plantae-test-support.tsx`), documentacao,
`.env`, certificados, migrations, Docker Compose, `env.validation.ts` (a mudanca local era so comentario e o arquivo local
carrega NFS-e/WhatsApp), `permission-code.enum.ts` (so texto de descricao), NFS-e e WhatsApp.

## 2. Os 19 arquivos

### 2.1 Substituidos (8): hash ANTES = versao `HEAD`, conferido na VPS

| Arquivo | Versao em producao antes | SHA-256 antes | SHA-256 depois |
| --- | --- | --- | --- |
| `backend/src/modules/integrations/plantae/plantae.controller.ts` | `b2006d9` | `a8eb09e2ab3d5730316aa1d04fe9fc36472eb1c099ac9e369475339e79c8d56e` | `3b87a7fb6828323936d249a516221df352680788557d878599b88a8f19308dd5` |
| `backend/src/modules/integrations/plantae/plantae-accounts-payable.command.ts` | `b2006d9` | `3847ba53199ab7531ec4f6e1a86c46a99a56f0f6752985dbb842ac0bd33091ca` | `327e467de4493cca37af021678a5bc523d8de92a73cedb682ee62bb5c27eebac` |
| `backend/src/modules/integrations/plantae/plantae.module.ts` | `b2006d9` | `33d960c10ca9cdc77d6739bd3f4557a0f51604d3931fa683a1a4ccf356a953be` | `8dea2e83d9c68fcde8f66af7202ed3d28554a04c35c7d64cebec8f5d70798e39` |
| `frontend/src/auth/permissions.ts` | `f97f24d` | `42471eaf4e19b5488c596505d5154728b26c660edc409ff1eca1db7eae869b12` | `3053097b8f911e4fa9ae6023ef07eb829bddf78aa8da11c32770893157e8665a` |
| `frontend/src/api/client.ts` | `c41951d` (troca de senha) | `f44723064020166de0a3c1a4f848b6d19b412d94b858adccde0d64a434dd4b13` | `3da6c0884ff970f494b53bb027541726ba3e40becc044eec80f59e459f22bad6` |
| `frontend/src/App.tsx` | `24f6f9e` (rota `/privacidade`) | `7ddf2d5d60a02944d6b827d30d269a926a07f7aa7df3a01a07ab569b17c3dd8f` | `1f5e7657b76b4d6f262b64509d8423579ec6309df591e88f2518560475ec0f8a` |
| `frontend/src/components/AppShell.tsx` | `f97f24d` | `8985773384bef2a357313ddb792f94e4eefecacd8db13bf3da8c31af42c4165e` | `4bead724d5023c71b53c593132ad328f093bfe9020ab1fc2a21f4d419627658e` |
| `frontend/src/pages/PrivacyPolicyPage.tsx` | `5cf86b4` | `36c5e2557fafb351db102e291f24bcc405bb4134498e01f5a79ba050d01e79f5` | `f3efb62d14107c429ef0b5c2fa3df772d3ac606d5f8d608348994e9671775542` |

### 2.2 Novos (11): ausentes na VPS antes da copia

| Arquivo | SHA-256 |
| --- | --- |
| `backend/src/modules/integrations/plantae/plantae-mask.ts` | `a3c1e4b73a2234583082b53e5fa4bae34f9c3ed27ea97df94a327b2e76725cf4` |
| `frontend/src/pages/plantae/PlantaePage.tsx` | `b428c8150dae0946315c328651035953c56392d466a9a2857de897de8d7bbc90` |
| `frontend/src/pages/plantae/EntriesTab.tsx` | `08cc5ef1b670ca8f508f450c5e7ffb90649b8a4fea231d6377d764740e0e8015` |
| `frontend/src/pages/plantae/MovementsTab.tsx` | `fa9879b39c0227e8ae60b06ad15265f27f05df7bb060f4dc74bd9fb30f77aa2e` |
| `frontend/src/pages/plantae/StatementTab.tsx` | `f9b99e47953270f0e026f3b579b7bcacda24d9a4835c4104e504a88d81df28dd` |
| `frontend/src/pages/plantae/AccountsTab.tsx` | `d0ae07777e92ce26fb87e92749b3db0e102f73c2ee88dfd75e26a96b9ab2367f` |
| `frontend/src/pages/plantae/PeopleTab.tsx` | `9a41e0c7f913285735f93f5c32c022c1ed7cd043c052a18d7d6ee1f45395a782` |
| `frontend/src/pages/plantae/plantae-format.ts` | `8be970cd8f350c76cc4a76d34582e082389945ae9de2b8e7f3ad77c8ef32c2bd` |
| `frontend/src/pages/plantae/plantae-errors.ts` | `78631b70dc9c9af78b1a8756261ab34b3732b383bcfee4954730f167cedd8744` |
| `frontend/src/pages/plantae/plantae-ui.tsx` | `8758ab3d1e3b9883c70689c81e95a5e4b3eb6bb4ecb998347b8148283682da13` |
| `frontend/src/pages/plantae/use-plantae-query.ts` | `033d080b895b65d76ae96541df5d1b5ee99c4b82ac1613e651efbc9bcf32db44` |

## 3. Procedimento

Ordem do plano aprovado (backend antes do frontend: o frontend novo com o backend antigo daria 403 ao GESTOR):

1. **Travas na VPS, antes de copiar:** `sha256sum -c pre.sha256` (8 OK) e nenhum caminho de `novos.txt` existente.
2. **Backup:** copia dos 8 arquivos originais num TAR e tags `:pre-plantae-painel` nas imagens `backend`, `migrate` e `nginx`
   (alem do backup do banco, por precaucao).
3. **Backend:** extrair `backend/*` do pacote, conferir os hashes, `build backend migrate`, `up -d backend`; `migrate` sem
   migration pendente; backend `healthy`.
4. **Frontend:** extrair `frontend/*`, `sha256sum -c pos.sha256` (19 OK), `build nginx`, `up -d nginx`,
   `scripts/https-verify.sh`.

Comandos completos, com `COMPOSE="docker compose -f docker-compose.production.yml -f docker-compose.https.yml"`: ver o plano
de deploy desta data (secao D) e as secoes 4 e 5 abaixo.

## 4. Resultados em producao

| Verificacao | Resultado |
| --- | --- |
| Pacote seletivo de 19 arquivos | Instalado |
| Migrations | Nenhuma executada |
| Backend e Nginx | Reconstruidos e saudaveis |
| MySQL, PostgreSQL e n8n | Saudaveis |
| Painel Plantae | As cinco abas testadas em producao |
| Telegram | `/contas_pagar` e `/contas_receber` funcionando |
| Mascaramento | Confirmado (CPF/CNPJ e numero de conta) |
| Politica de privacidade | Publicada como "Atualizacao pendente de aprovacao" (`docs/politica-privacidade-revisao.md`, secao 6) |
| Backups | Arquivos originais e imagens Docker preservados |

Testes locais antes do pacote: backend 3566 unitarios e 1036 e2e; frontend 468 testes; typecheck, lint e build de producao.

## 5. Rollback

O frontend volta primeiro, para nunca ficar o frontend novo apontando para o backend antigo. Nao ha passo de banco: nao
houve migration. `$B` e o diretorio do backup criado no passo 2 (confirmar o nome exato na VPS).

```bash
cd /opt/vastaflow
export COMPOSE="docker compose -f docker-compose.production.yml -f docker-compose.https.yml"
# frontend
docker tag vastaflow-nginx:pre-plantae-painel vastaflow-nginx:latest
$COMPOSE up -d --no-build --force-recreate nginx
# backend
docker tag vastaflow-backend:pre-plantae-painel vastaflow-backend:latest
docker tag vastaflow-migrate:pre-plantae-painel vastaflow-migrate:latest
$COMPOSE up -d --no-build --force-recreate backend
# codigo-fonte de volta ao estado anterior (para um build futuro nao reintroduzir a mudanca)
tar -xf "$B/originais.tar" -C /opt/vastaflow
rm -f backend/src/modules/integrations/plantae/plantae-mask.ts
rm -rf frontend/src/pages/plantae
sha256sum -c ~/deploy-plantae-painel/pre.sha256      # 8 OK
```

Depois do rollback: o painel some do menu; `/contas_receber` deixa de existir; `/contas_pagar` volta a ter limite proprio;
as rotas de consulta voltam a ser so do ADMIN; a politica de privacidade volta a versao de 28/10/2026, que afirma que o
Plantae esta desligado (e preciso decidir o que publicar nesse caso).

## 6. Pendencias

1. **Commit** das alteracoes implantadas, para o repositorio registrar exatamente o que esta em producao (os hashes da
   secao 2 permitem conferir).
2. **Aprovacao formal** da politica de privacidade atualizada (`docs/politica-privacidade-revisao.md`, secao 6).
3. Guardar fora do repositorio: confirmacao escrita do fornecedor sobre o host e os escopos de producao, e o registro da
   conferencia da organizacao (`docs/integracao-plantae.md`, 11.3 e 12.6).
4. Remover da VPS, quando nao forem mais necessarios, a pasta do pacote (`~/deploy-plantae-painel`) e, depois de um periodo de
   estabilidade, o backup e as tags `:pre-plantae-painel`.
