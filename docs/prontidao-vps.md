# Prontidao para a VPS — o que existe, o que falta, antes de comprar

> **Nao ha afirmacao de "pronto para producao".** A stack foi validada **localmente** (Docker Desktop). Nada foi
> executado em Linux/VPS, com HTTPS publico, carga real ou restauracao de backup. Este documento separa o que esta
> **provado**, o que esta **escrito mas nao testado** e o que **nao existe**.

## 1. Quadro

| Item | Estado | Evidencia / lacuna |
| --- | --- | --- |
| Compose de producao (`docker-compose.production.yml`) | **provado local** | stack saudavel; ordem mysql -> migrate -> backend -> nginx; `down` sem `-v` preserva dados |
| Reinicio automatico | **configurado**, nao testado em reboot | `restart: unless-stopped` em mysql, backend, nginx, n8n, n8n-postgres; `migrate` roda uma vez (`restart: no`) |
| Healthchecks | **provado local** | mysql, backend (`/health/readiness`), nginx, n8n-postgres, n8n |
| Limites de recurso e rotacao de log | **configurado** | `deploy.resources` por servico; json-file 10 MB x 3 |
| Redes e exposicao | **provado local** | MySQL/PostgreSQL/backend sem porta no host; n8n so em `127.0.0.1`; `/api/service*` = 404 na borda |
| TLS entre backend e MySQL | **provado local** | `require_secure_transport=1`, TLSv1.3, verificacao de identidade |
| Migrations | **provado local** | `migrate` antes do backend; backend se recusa a subir com migration pendente |
| Segredos | **parcial** | `.env` fora do Git; falta politica no servidor (permissao 600, quem acessa, rotacao) |
| **HTTPS publico** | **NAO EXISTE** | Nginx escuta so `:80`. Sem dominio, DNS nem certificado. **Bloqueia o webhook da Meta** (exige HTTPS valido) e o login seguro |
| **Backup externo** | **NAO EXISTE** | nenhum script; nenhum destino externo; ADR 0003 o declara requisito de go-live |
| **Restauracao testada** | **NAO EXISTE** | nunca exercitada |
| **Plano de atualizacao e rollback** | **NAO EXISTE** (esboco abaixo) | nunca ensaiado |
| Firewall / acesso SSH do host | **fora do repositorio** | a definir na VPS (so 80/443 + SSH restrito) |
| Proteção do n8n | **parcial** | editor so em loopback (acesso por tunel SSH); webhook interno; sem execucao gravada alem de ~segundos; senha forte do dono |
| Webhook publico do WhatsApp | **codigo e Nginx prontos**, HTTPS ausente | `docs/whatsapp.md` |
| Observabilidade | **minima** | logs de container; sem alerta, sem metrica, sem verificacao externa de uptime |
| Carga / desempenho na VPS | **nao medido** | limites foram definidos a partir de Docker Desktop de 3,8 GB |

## 2. O que decidir/comprar ANTES da VPS

1. **Dominio e DNS** (ADR 0003 previa `app.`, `api.`, `n8n.`; o Nginx atual serve SPA + `/api` em um host so — decidir qual).
2. **Estrategia de certificado** (ex.: certificado emitido no proprio host por ACME, ou terminacao TLS em outro servico). Nao implementado.
3. **Destino do backup externo** (armazenamento de objetos ou outra maquina), **cifrado**, com credenciais proprias e **retencao**.
4. **Quem opera**: acesso SSH, chaves, responsavel por restaurar.
5. Confirmar o **plano da VPS** (memoria: MySQL + PostgreSQL + n8n + backend + Nginx cabem? medir antes de assumir).

## 3. Backup e restauracao (proposta; NAO testada)

- **MySQL:** dump logico consistente (`--single-transaction`) agendado, cifrado, enviado para fora; teste de restauracao em banco limpo, **antes** do go-live.
- **PostgreSQL do n8n:** `pg_dump` (nao copiar o volume com o banco ligado).
- **`N8N_ENCRYPTION_KEY`:** copia **fora da VPS**, separada dos backups (sem ela as credenciais do n8n ficam ilegiveis).
- **Documentos (volume):** copia do volume `documents`, junto com o dump (ha inconsistencia possivel entre banco e arquivo).
- **`.env` e certificados:** guardados no cofre de segredos, nao no mesmo destino dos dumps.
- Backups de volume do n8n devem ser tratados como **dado pessoal** (ver `telegram-n8n.md` secao 14).
- Criterio de aceite: restaurar tudo numa maquina limpa e a stack subir saudavel, com os dados e as credenciais do n8n.

## 4. Atualizacao e rollback (esboco; nao ensaiado)

1. Antes: backup do MySQL e do PostgreSQL; anotar a versao (commit/tag) em producao.
2. `git pull` da versao taggeada; `docker compose build backend migrate nginx` (**sempre `backend` e `migrate` juntos**).
3. `docker compose up -d`: o `migrate` roda antes; o backend so sobe com o banco atualizado.
4. Conferir `ps`, healthchecks, `/health`, um comando de teste.
5. **Rollback:** voltar a versao anterior e `up -d`. Migrations sao so para frente: se a nova migration mudou o schema de forma incompativel, **restaurar o backup** feito no passo 1. Ensaiar isto antes do go-live.
6. Atualizar o n8n so em versao fixada (a imagem esta fixada em 2.43.1) e apos backup.

## 5. Antes de dizer "pronto para producao"

HTTPS publico funcionando; backup externo e **restauracao** exercitados; plano de atualizacao/rollback ensaiado; teste
de reboot da VPS (servicos voltam sozinhos); firewall e acesso do host revisados; rotacao de segredos definida;
monitoramento minimo (uptime externo + alerta de disco/falha); revisao dos limites com carga medida.
