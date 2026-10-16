# Roteiro de implantação na VPS (Hostinger, Docker Compose, Nginx, HTTPS)

> **Estado: roteiro PREPARADO, ainda não executado em nenhuma VPS.** O que foi exercitado até aqui está marcado em cada
> passo (`[testado local]`, `[testado local, parcial]` ou `[NÃO testado]`). Nenhum domínio, DNS ou servidor existe: todo
> nome abaixo (`app.exemplo.com.br`) é **fictício**. Nada neste roteiro deve ser executado sem decidir os itens da seção 0.

## 0. Decisões que dependem do dono do projeto (nada disto foi contratado)

| # | Decisão | Opções | Por que importa |
| --- | --- | --- | --- |
| 1 | **Dominio** e quem controla o DNS | **inicial (decidido): subdominio gratuito DuckDNS**, ex.: `vastaflow.duckdns.org` (secao 5.1); depois, dominio da cliente (`app.<dominio>`) | o webhook da Meta exige HTTPS valido; o Let's Encrypt so emite para nome que resolva para a VPS |
| 2 | **Plano da VPS** | KVM 4 (decisão anterior) | os limites de recurso do Compose foram medidos num Docker Desktop de 3,8 GB, **não** na VPS |
| 3 | **Destino do backup externo** | ver `docs/backup-restauracao.md`, seção 6 | sem ele um backup só protege de erro humano, não de perder a VPS |
| 4 | **Quem guarda a chave privada do backup** | dono do projeto + 1 cópia em cofre | sem ela **não existe restauração** |
| 5 | **Quem opera** a VPS (SSH, atualização, restauração) | — | rotação de segredos e resposta a incidente |

## 1. Provisionar a VPS `[NÃO testado]`
1. Ubuntu Server 24.04 LTS, sem painel de terceiros pré-instalado. Anote o IP público.
2. Ative, se o painel oferecer, **snapshot** antes de cada atualização (complementa o backup; não o substitui).
3. Atualize: `apt update && apt -y upgrade`, reinicie se pedir kernel novo.

## 2. SSH e firewall `[NÃO testado]`
```bash
adduser deploy && usermod -aG sudo deploy          # usuário sem privilégio de root direto
# copie SUA chave pública para /home/deploy/.ssh/authorized_keys (modo 600)
# /etc/ssh/sshd_config.d/10-vastaflow.conf:
#   PermitRootLogin no
#   PasswordAuthentication no
#   AllowUsers deploy
systemctl reload ssh

ufw default deny incoming && ufw default allow outgoing
ufw allow from <SEU_IP_FIXO> to any port 22 proto tcp   # ou: ufw limit 22/tcp se o IP não for fixo
ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```
**Atenção:** o Docker publica portas **por fora do UFW** (regras próprias no iptables). Por isso a stack **não publica nada
além de 80/443**: MySQL, PostgreSQL e backend não têm `ports:`, e o editor do n8n escuta só em `127.0.0.1:5678`. Confira depois
de subir (seção 9): `ss -ltnp` deve mostrar só 22, 80 e 443 em endereço público.

## 3. Docker `[NÃO testado na VPS; versões locais: Engine 29.8.2, Compose 5.5.1]`
Instale o Docker Engine e o plugin Compose pelo repositório **oficial** da Docker (não o pacote `docker.io` da distribuição).
`usermod -aG docker deploy`. Confirme `docker compose version` (a sobreposição HTTPS usa `ports: !override`, recurso do Compose v2.24+).

## 4. Código e variáveis privadas `[testado local, parcial]`
```bash
sudo mkdir -p /opt/vastaflow && sudo chown deploy: /opt/vastaflow
git clone <repositorio> /opt/vastaflow && cd /opt/vastaflow && git checkout <tag-da-versao>
cp .env.example .env && chmod 600 .env
```
Preencha o `.env` **na VPS** (nunca no Git, nunca no chat). Gere cada segredo com `openssl rand -hex 32`:
`DATABASE_ROOT_PASSWORD`, `DATABASE_PASSWORD`, `JWT_SECRET`, `N8N_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `TELEGRAM_INGEST_SIGNING_KEY`
e a senha do dono do n8n. Defina `SERVER_NAME` e `LETSENCRYPT_EMAIL` (seção 6).
**Mantenha desligados** `WHATSAPP_ENABLED`, `NFSE_ENABLED`, `PLANTAE_ENABLED` e `PLANTAE_CHAT_COMMANDS_ENABLED` até haver decisão
e credenciais (cada um tem seu documento). **Faça uma cópia do `.env` e de `N8N_ENCRYPTION_KEY` fora da VPS**: sem a chave o n8n
não lê as próprias credenciais (o backup de configuração também a leva, cifrada).

TLS interno (backend ⇄ MySQL): gere **na sua máquina**, não na VPS, com `scripts/gerar-tls-dev.sh` (o nome diz "dev", mas o
mecanismo é o mesmo; ver ADR 0003). Copie para a VPS **somente** `infra/tls/mysql/` e `infra/tls/backend/`
(`scp -r`), mantenha `infra/tls/ca-private/` (a chave da CA) **offline**. Credenciais de serviço do n8n:
`infra/service-auth/credentials.json` pelo CLI descrito em `docs/autenticacao-servico-a-servico.md`.

## 5. DNS `[NAO testado: nao ha dominio nem VPS]`
Crie o registro **A** de `SERVER_NAME` para o IP da VPS (e AAAA so se a VPS tiver IPv6 funcionando e liberado no firewall).
Espere propagar: `dig +short <SERVER_NAME>` deve devolver o IP. **Nao** rode o passo 6 antes: o Let's Encrypt limita tentativas
falhas por dominio — por isso o `https-init.sh` **recusa** rodar se o nome ainda nao resolver (e, com `EXPECTED_PUBLIC_IP`, se
resolver para outro IP).

### 5.1 Subdominio gratuito DuckDNS (inicial) `[testado local: atualizador e HTTP-01 contra servidor ACME de teste; NAO testado: DuckDNS real]`
O HTTPS desta stack usa o desafio **HTTP-01 (porta 80)**, que nao depende de quem hospeda o DNS: `vastaflow.duckdns.org`
funciona **exatamente** como um dominio pago (o `https-init.sh` o reconhece e confere o formato). Nao ha curinga: um nome, um certificado.
1. **Voce** cria o subdominio na sua conta DuckDNS (este projeto nao cria conta nem registra nada) e **copia o token direto para a VPS**,
   nunca para o chat nem para o Git:
   ```bash
   sudo install -d -m 700 /etc/vastaflow
   sudo cp infra/duckdns/duckdns.env.example /etc/vastaflow/duckdns.env && sudo chmod 600 /etc/vastaflow/duckdns.env
   sudoedit /etc/vastaflow/duckdns.env          # DUCKDNS_DOMAIN=vastaflow  (so o subdominio)  e  DUCKDNS_TOKEN=...
   sudo bash scripts/duckdns-update.sh           # "DuckDNS: OK (vastaflow.duckdns.org atualizado)"
   sudo cp infra/duckdns/vastaflow-duckdns.service infra/duckdns/vastaflow-duckdns.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now vastaflow-duckdns.timer   # reatualiza a cada 10 min e no boot
   ```
   O `duckdns-update.sh` entrega a URL (com o token) ao `curl` por **stdin** (o token nao aparece em `ps`), so fala HTTPS, nao segue
   redirecionamento e nunca imprime o token. `DUCKDNS_IP` fixa o IPv4; vazio = o DuckDNS usa o IP de origem (a VPS).
2. No `.env` da VPS: `SERVER_NAME=vastaflow.duckdns.org` e `LETSENCRYPT_EMAIL=<seu e-mail>`.
3. `dig +short vastaflow.duckdns.org` deve mostrar o IP da VPS; so entao a secao 6.
4. **Trocar para dominio proprio depois** nao exige mudanca de codigo: ajuste `SERVER_NAME`, aponte o DNS, rode
   `bash scripts/https-init.sh` de novo (emite o novo certificado) e atualize a URL do webhook na Meta. O timer do DuckDNS pode ser desativado.

**Riscos do DuckDNS (aceitos para comecar):** servico gratuito de terceiros — se o DuckDNS cair, o nome para de resolver (site e webhook
ficam inacessiveis; os dados nao sao afetados); o token e um segredo (quem o tem controla o seu IP); o subdominio pertence ao DuckDNS, nao
a cliente, entao a recomendacao e migrar para um dominio proprio antes de a operacao depender do sistema. A aceitacao da URL pela Meta
**nao** foi verificada.

## 6. Build, HTTPS e subida `[testado local: configuração Nginx/TLS/webhook; NÃO testado: emissão real do certificado]`
```bash
cd /opt/vastaflow
export COMPOSE="docker compose -f docker-compose.production.yml -f docker-compose.https.yml"
$COMPOSE build backend migrate nginx          # SEMPRE backend e migrate juntos
STAGING=1 bash ./scripts/https-init.sh             # ensaio no Let's Encrypt de teste (certificado não confiável, sem limite)
# se deu certo, e só então:
docker run --rm -v vastaflow-letsencrypt:/etc/letsencrypt alpine:3.20 rm -rf /etc/letsencrypt/live /etc/letsencrypt/archive /etc/letsencrypt/renewal
bash ./scripts/https-init.sh                        # emissão real
bash ./scripts/https-verify.sh                      # confere HTTPS, certificado, HSTS, bloqueios e o webhook (imprime a URL dele)
$COMPOSE up -d
```
O `https-init.sh` cria um certificado temporário (o nginx não sobe sem um), emite o real pelo desafio HTTP-01, recarrega o nginx e
liga o contêiner `certbot`, que tenta renovar a cada 12 h; o nginx recarrega a cada 6 h para usar o certificado novo.
**Limitações conhecidas:** (1) a emissão só foi ensaiada até o ponto anterior ao Let's Encrypt; (2) HSTS começa em **1 dia**
(`frontend/nginx/conf.d/02-hsts.conf`); suba para 1 ano só depois de dias de operação estável; (3) um único host serve app e `/api`
(a separação em três subdomínios do ADR 0003 **não** foi implementada: o editor do n8n continua fora da internet).

## 7. Migrations `[testado local]`
O serviço `migrate` roda `migration:run` **antes** do backend e o backend se recusa a subir com migration pendente.
Confirme: `$COMPOSE logs migrate | tail` ("No migrations are pending" ou "executed successfully"; exit 0).

## 8. Primeiro ADMIN
Defina `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` no `.env` **só para o primeiro boot**, suba o backend, entre, **remova as duas
variáveis** e recrie o backend. Não crie ADMIN por outro caminho.

## 9. Verificações de saúde `[testado local]`
```bash
$COMPOSE ps                                    # todos healthy (n8n pode levar ~1 min)
ss -ltnp | grep -E 'LISTEN' | awk '{print $4}' # só :22, :80, :443 (+ 127.0.0.1:5678)
curl -fsS https://app.exemplo.com.br/nginx-health          # ok
curl -fsS https://app.exemplo.com.br/api/health            # liveness
curl -s -o /dev/null -w '%{http_code}\n' https://app.exemplo.com.br/api/health/readiness   # 403 (de propósito)
curl -s -o /dev/null -w '%{http_code}\n' https://app.exemplo.com.br/api/service/x          # 404 (de propósito)
curl -sI http://app.exemplo.com.br/ | head -n1                                              # 301 para https
```
Editor do n8n (nunca público): `ssh -L 5678:127.0.0.1:5678 deploy@<IP>` e abra `http://127.0.0.1:5678` no seu computador.

## 10. Teste do webhook HTTPS (WhatsApp) `[testado local contra backend que imita o contrato; NAO testado com a Meta]`
A URL do webhook e **derivada** (nao ha variavel propria): `https://<SERVER_NAME>/api/webhooks/whatsapp`, ex.:
`https://vastaflow.duckdns.org/api/webhooks/whatsapp`. `bash scripts/https-verify.sh` a imprime e confere, sem chamar a Meta:
com `WHATSAPP_ENABLED=false` todo pedido ao webhook recebe **404**; ligado, um pedido **sem assinatura valida**
(`X-Hub-Signature-256`) ou com token de verificacao errado recebe **403** — nunca 2xx. O Nginx repassa o corpo **bruto e intacto**
(a assinatura HMAC e calculada sobre os bytes exatos; um byte alterado -> 403, provado no teste local). So depois de decidir numero,
conta Meta e ligar as 5 variaveis `WHATSAPP_*` (ver `docs/whatsapp.md`) cole a URL no painel da Meta; a verificacao real e a dela
ao salvar o webhook.

## 11. Backup e primeira restauração `[testado local no sistema de teste isolado; NÃO testado na VPS]`
Siga `docs/backup-restauracao.md` (importar **só a chave pública**, `backup.env`, timer do systemd, primeira execução manual).
**Antes de entregar à cliente**, rode `scripts/restore-test.sh` num computador com Docker e faça **uma restauração real do
primeiro backup da VPS** num ambiente separado. Um backup nunca restaurado não é backup.

## 12. Atualização `[NÃO testada na VPS]`
1. `./scripts/backup.sh` (e snapshot da VPS). Anote o commit atual: `git rev-parse --short HEAD`.
2. `git fetch --tags && git checkout <nova-tag>`.
3. `$COMPOSE build backend migrate nginx` (juntos) e `$COMPOSE up -d`. O `migrate` roda antes; só o backend e o nginx são recriados
   (os bancos e o n8n não, a menos que a imagem deles mude).
4. Repita a seção 9. Um comando de teste de cada canal que estiver ligado.
5. n8n: só suba de versão com a imagem fixada no Compose, depois de backup.

## 13. Rollback `[caminho 13.1 testado em outro ambiente; 13.2 NÃO ensaiado na VPS]`
**13.1 — só código (migration nova compatível, ex.: apenas cria tabela):**
`git checkout <tag-anterior>` → `$COMPOSE build backend migrate nginx` → `$COMPOSE up -d`. A tabela nova fica sem uso. As
migrations deste projeto são **aditivas**; confira o `down` da migration antes de decidir revertê-la (`migration:revert` é manual).

**13.2 — dados (a atualização estragou dados ou o schema):**
restaurar o backup feito no passo 12.1 **sobre a produção** é destrutivo e exige as duas travas do `restore.sh`:
```bash
$COMPOSE stop backend nginx
VF_COMPOSE="$COMPOSE" VF_RESTORE_CONFIRM=restaurar-em-vastaflow \
VF_RESTORE_ALLOW_PRODUCTION=SOBRESCREVER-PRODUCAO VF_RESTORE_FORCE=1 \
  ./scripts/restore.sh /var/backups/vastaflow/<carimbo>      # exige a chave PRIVADA no gpg de quem roda
git checkout <tag-anterior> && $COMPOSE build backend migrate nginx && $COMPOSE up -d
```
Esse caminho está **provado em um projeto descartável** (`scripts/restore-test.sh`), mas **não** sobre o projeto `vastaflow` real.
Antes de depender dele, ensaie-o na VPS com um backup real, num horário sem uso.

## 14. Perda total da VPS (recuperação de desastre) `[NÃO ensaiada]`
Nova VPS (seções 1–6, **sem** subir a aplicação) → trazer o último backup do destino externo → restaurar a configuração
(`VF_CONFIG_OUT`, copiar `.env`/`infra/tls`/credenciais conscientemente) → `restore.sh` num projeto vazio → subir → seção 9.
O DNS precisa apontar para o novo IP (TTL baixo ajuda).

## Testes locais que ja existem (rodam sem VPS, so com Docker; nenhum toca a stack real)
| Comando | O que prova |
| --- | --- |
| `bash infra/https/test-https.sh` | Nginx/TLS/HSTS/redirecionamento/bloqueios com o nome `vastaflow.duckdns.org`; webhook com assinatura HMAC preservada ponta a ponta; `https-verify.sh` contra a pilha |
| `bash infra/https/test-acme.sh` | desafio **HTTP-01** completo contra o Pebble (servidor ACME de teste do Let's Encrypt): emissao, troca do certificado temporario, renovacao; e a recusa quando o DNS nao aponta |
| `bash infra/duckdns/test-duckdns.sh` | atualizador do DuckDNS contra servidor falso: token fora do argv e da saida, entradas invalidas recusadas, sem redirecionamento |
| `bash scripts/restore-test.sh` | backup cifrado, origem destruida, restauracao e uso pela API (docs/backup-restauracao.md) |
Nenhum deles fala com o Let's Encrypt real, com o DuckDNS real ou com a Meta.

## 15. O que ainda NÃO está resolvido
Observabilidade/alerta e verificação externa de uptime; teste de reboot da VPS; carga real; rotação de segredos definida;
destino externo do backup; chave privada do backup custodiada; emissão real do certificado; Meta/WhatsApp; certificado e dados
fiscais da NFS-e; organização do Plantae.
