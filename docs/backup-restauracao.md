# Backup externo e restauração

> **Estado:** mecanismo de backup **cifrado** e de restauração **implementado e exercitado em ambiente isolado**, com dados
> sintéticos. **Não** foi executado na VPS (ela não existe), **nenhum destino externo foi escolhido ou contratado** e **a chave
> privada de backup ainda não existe**. Enquanto essas duas decisões não forem tomadas, o backup protege de erro humano, **não** da
> perda da VPS.

## 1. O que é copiado

| Fonte | Como | Arquivo (cifrado) |
| --- | --- | --- |
| MySQL (negócio, usuários, auditoria, vínculos, `nfse_emissions` com XML da NFS-e) | `mysqldump --single-transaction --routines --triggers --events` | `mysql.sql.gz.gpg` |
| PostgreSQL do n8n (workflows, credenciais cifradas do n8n) | `pg_dump --format=custom` | `n8n-postgres.pgdump.gpg` |
| Documentos privados (volume `vastaflow-documents`) | `tar` do volume, **depois** dos bancos | `documents.tar.gz.gpg` |
| Estado do n8n (volume `vastaflow-n8n-state`) | `tar` do volume | `n8n-state.tar.gz.gpg` |
| Configuração operacional: `.env` (inclui `N8N_ENCRYPTION_KEY`), `infra/tls`, `infra/service-auth` | `tar` | `config.tar.gz.gpg` |
| Manifesto e hashes | texto, **sem segredo** | `MANIFESTO.txt`, `SHA256SUMS` |

Os documentos fiscais privados **hoje** estão no MySQL (a NFS-e guarda o XML na coluna `nfse_xml`) e, se houver, no volume de
documentos: os dois estão cobertos. **Certificado digital da NFS-e:** quando existir, fica num arquivo `.pfx` montado somente leitura
fora do Git; **inclua o diretório dele em `VF_CONFIG_PATHS`** (e guarde a senha no cofre, não no `.env` do backup se preferir). Não
há certificado ainda.

## 2. Segurança do esquema

- **Criptografia de chave pública (gpg):** a VPS tem só a chave **pública**. Quem invadir a VPS **não** consegue ler backups
  antigos (provado: o chaveiro só-público da VPS recusa decifrar).
- **Nenhum dado em claro toca o disco:** cada fonte é canalizada direto para o `gpg`.
- **Senhas fora da linha de comando:** os dumps usam variáveis que o próprio contêiner já tem (teste estático impede regressão).
- **Integridade:** `SHA256SUMS` dos arquivos cifrados; o `restore.sh` confere antes de tocar em qualquer coisa. Adulterar 1 byte é
  recusado (provado).
- **Retenção local:** `BACKUP_RETENTION_DAYS` (14) preservando sempre os `BACKUP_KEEP_MIN` (3) mais recentes (e nunca um backup com envio externo pendente). **Remota:** 7 diários + 4 semanais + 3 mensais, mais um orçamento de bytes — ver `docs/backup-google-drive.md`.
- **Travas do restore:** exige confirmar o projeto-alvo por nome, recusa a produção sem `SOBRESCREVER-PRODUCAO`, recusa alvo com dados
  sem `VF_RESTORE_FORCE=1`, e **nunca** sobrescreve a configuração existente (vai para uma pasta nova).

## 3. Configuração na VPS `[NÃO executado]`
```bash
# NO SEU COMPUTADOR (não na VPS): gere o par de chaves e guarde a PRIVADA fora da VPS
gpg --quick-generate-key "backup-vastaflow@<seu-dominio>" rsa4096 encr 0
gpg --armor --export <FINGERPRINT> > backup-publica.asc            # esta vai para a VPS
gpg --armor --export-secret-keys <FINGERPRINT> > backup-privada.asc  # NUNCA vai para a VPS; 2 cópias em locais seguros
# NA VPS (usuário que roda o backup):
gpg --import backup-publica.asc
sudo install -d -m 700 /etc/vastaflow && sudo cp infra/backup/backup.env.example /etc/vastaflow/backup.env && sudo chmod 600 /etc/vastaflow/backup.env
# edite BACKUP_GPG_RECIPIENT (e BACKUP_REMOTE depois da decisão da seção 6)
sudo cp infra/backup/vastaflow-backup.{service,timer} /etc/systemd/system/   # ajuste WorkingDirectory/ExecStart
sudo systemctl daemon-reload && sudo systemctl enable --now vastaflow-backup.timer
sudo systemctl start vastaflow-backup.service && journalctl -u vastaflow-backup -n 30   # primeira execução manual
```
Sem a chave privada **não existe restauração**: é a decisão nº 4 do `docs/deploy-vps.md`. Uma senha na chave privada é
recomendável; ela deve ser guardada separada da chave.

## 4. Restauração `[exercitada só no sistema de teste]`
```bash
# num computador com Docker e a chave PRIVADA (idealmente NÃO a VPS de produção), alvo vazio:
VF_COMPOSE="docker compose -p meu-alvo -f docker-compose.production.yml" \
VF_DOCUMENTS_VOLUME=meu-alvo_documents VF_N8N_STATE_VOLUME=meu-alvo_n8n-state \
VF_RESTORE_CONFIRM=restaurar-em-meu-alvo ./scripts/restore.sh /caminho/do/backup/20261016T033000Z
```
Depois: subir o backend sobre os dados, entrar com o ADMIN e conferir (seção 5 mostra o que o teste confere). Para recuperar a
**produção** no lugar, ver `docs/deploy-vps.md` seção 13.2.

## 5. Evidência: `scripts/restore-test.sh` (executado em 2026-10-16, Docker Desktop, Windows 11)
Stack **descartável** `vf-rt-src` (MySQL 8.4.9 com TLS, PostgreSQL 18, `migrate` e **backend reais** deste commit), dados criados
pela API real e senhas aleatórias de uso único. Resultado: **24 verificações, 0 falhas, `RESTORE TEST: PASS`.**

| Passo | Evidência |
| --- | --- |
| Dados de origem | ADMIN semeado pelo backend, 5 lançamentos (saldo 3.290,33), 1 documento CSV de 5.965 bytes, 2.000 linhas no PostgreSQL, 11 migrations |
| Backup com chaveiro **só-público** | 5 arquivos cifrados + manifesto + `SHA256SUMS`; 38 KB |
| Opacidade | busca por 8 textos conhecidos (descrições, e-mail do ADMIN, senha do banco, segredo da configuração, `CREATE TABLE`): **0 ocorrências** nos arquivos |
| Sem a chave privada | decifrar com o chaveiro da "VPS" **falha**; com a privada, o dump é um dump MySQL |
| Integridade | 1 byte alterado em `mysql.sql.gz.gpg` → restauração **recusada** antes de qualquer escrita |
| Origem destruída | `down -v` do projeto descartável; volumes de MySQL e documentos **inexistentes** depois |
| Travas | sem confirmação, com projeto errado e contra o projeto de produção sem a trava explícita: **recusado**; 2ª restauração sobre dados existentes: **recusada** |
| Dados recuperados | MySQL: contagens idênticas (`1 5 1 11` = usuários, lançamentos, documentos, migrations); PostgreSQL: **md5 e contagem idênticos**; estado do n8n: arquivo idêntico; configuração em pasta nova |
| Sistema usa os dados | `migrate` sobre o restaurado: "No migrations are pending"; backend sobe; **login do ADMIN restaurado**, 5 lançamentos, saldo e **SHA-256 do documento idênticos** ao original, lidos pela API |

**O que este teste NÃO prova:** o n8n subindo sobre o PostgreSQL restaurado (só os dados foram comparados); a cópia para um destino
externo (`rclone`); a execução na VPS/Linux (o script roda no host em que for chamado); a restauração do projeto real `vastaflow`;
volumes grandes (documentos reais) e tempo de restauração; a consistência cruzada banco × documentos sob escrita concorrente.

## 6. Destino externo — provisório decidido: Google Drive (`docs/backup-google-drive.md`); alternativas abaixo mantidas como referência
> **Decisão atual:** Google Drive via `rclone`, escopo `drive.file`, tudo cifrado com gpg antes do envio. Preparado e testado só com dados fictícios e sem Google; **nada foi autenticado nem enviado**. Procedimento, política de retenção e checklist de ativação: [`backup-google-drive.md`](backup-google-drive.md).
O `backup.sh` já copia e **verifica** (`rclone check`) para qualquer destino do `rclone`; falta escolher. Como os arquivos já saem
**cifrados**, o provedor do destino não lê o conteúdo. Alternativas:

| Opção | Prós | Contras | Custo (ordem de grandeza, **confirmar no site**) |
| --- | --- | --- | --- |
| **A. Armazenamento de objetos S3-compatível** (Backblaze B2, Cloudflare R2, Wasabi, etc.) | barato, durável, sem servidor para manter, versionamento/retenção do provedor | conta e cartão do dono; lembrar credenciais | centavos a poucos dólares/mês para o volume esperado |
| **B. Outra máquina por SFTP** (um servidor seu, NAS, outra VPS) | controle total, sem terceiros | você mantém a máquina, o disco e o acesso; é um novo alvo a proteger | custo da máquina |
| **C. Snapshot/backup do próprio Hostinger** | integrado, simples | mesma conta e mesmo provedor da VPS: **não cobre** perda da conta/provedor, restauração parcial (um banco) é difícil; usar **só como complemento** | conforme o plano |
| **D. Disco/nuvem pessoal da cliente ou sua** (Google Drive, OneDrive via `rclone`) | já existe | limites de API, dependência de uma conta pessoal | grátis/baixo |

**Recomendação:** A (objeto S3-compatível, de um provedor **diferente** da Hostinger) + snapshot da VPS (C) como complemento.
Credenciais do destino ficam em `~/.config/rclone/rclone.conf` (modo 600) **da VPS** e **nunca** no Git, no chat ou no `.env` do backup.
Para criar a chave do destino, use uma chave **só de escrita/limitada ao bucket** (sem permissão de apagar tudo).

## 7. Operação contínua (a fazer quando houver VPS)
- **Teste de restauração periódico** (mensal): `scripts/restore-test.sh` num computador com Docker **e**, trimestralmente, restaurar
  um backup **real** num ambiente separado.
- **Alerta de falha:** `systemctl status vastaflow-backup` não avisa ninguém; configure um monitor externo (ex.: ping de "heartbeat"
  ao fim de um backup bem-sucedido). **Não implementado.**
- **Espaço em disco:** o backup local cresce com os documentos; acompanhe `df -h` (a retenção apaga por idade, não por espaço).
- **Rotação de chave:** gere novo par, adicione a nova pública aos destinatários (o script usa **um** destinatário: para trocar,
  edite `BACKUP_GPG_RECIPIENT`) e **guarde a privada antiga** enquanto houver backups cifrados com ela.

## 8. Limites conhecidos
Backup de documentos copiado **depois** dos bancos: um arquivo pode existir sem linha no banco (órfão inofensivo), nunca o inverso;
sem janela de manutenção, escritas durante o `tar` podem gerar um arquivo parcial (o `tar` da imagem auxiliar avisa e o backup
falha de forma visível). O tamanho de documentos reais ainda é desconhecido. O backup não inclui imagens Docker (reconstruídas do
Git) nem logs.
