# Backup externo no Google Drive (provisório) — rclone + GPG

> **Estado: PREPARADO e testado com dados fictícios. NADA foi autenticado e NENHUM dado real foi enviado ao Google Drive.**
> Nenhuma conta Google foi conectada, nenhum projeto no Google Cloud foi criado, nenhum arquivo do VastaFlow saiu desta máquina.
> O envio real só acontece depois que **você** autorizar, na ordem da seção 8.

## 1. Como funciona
```
backup.sh  →  cada fonte é cifrada com a sua chave PÚBLICA gpg (nada em claro em disco)
           →  rclone envia a pasta do backup (já cifrada) para  gdrive:vastaflow-backups/<carimbo>/
           →  rclone check confere os hashes;  só então poda o destino (retenção + orçamento)
falha?     →  o backup LOCAL fica preservado, o envio fica "pendente" e é reenviado na próxima execução; alerta no Telegram
vigia      →  1x/dia confere: backup novo (local e no Drive)? sobra espaço? há envio pendente?
```
O Google vê apenas arquivos cifrados (`*.gpg`), mais o `MANIFESTO.txt` (nomes, tamanhos, nome da máquina, commit do Git, impressão digital
da chave pública) e o `SHA256SUMS`. Sem a chave **privada**, nem o Google nem quem invadir a VPS lê o conteúdo.

## 2. Tamanho atual e projeção (medido em 2026-10-19; só totais)
| Item | Tamanho hoje |
| --- | --- |
| MySQL (dados + índices, 15 tabelas) | 0,7 MB → dump comprimido **6,5 KB** |
| PostgreSQL do n8n | 17,7 MB → dump comprimido **0,56 MB** (é quase todo o backup) |
| Estado do n8n (7 arquivos) | 30 KB → **2,6 KB** |
| Documentos privados | **0 arquivos** (volume vazio) |
| Configuração (`.env`, TLS, credenciais de serviço) | **7,9 KB** |
| **Um backup completo** | **≈ 0,58 MB** (cifrado ≈ o mesmo) |

Projeção (**premissas, não medições**): o MySQL cresce com auditoria e NFS-e (~1 KB por evento; ~10 KB por NFS-e) → dezenas de MB
comprimidos em um ano; o n8n tende a ficar estável (a retenção de execuções é mínima). **O fator desconhecido são os documentos**
(limite de 10 MB por arquivo): cada backup carrega *todos* os documentos de novo.

| Documentos comprimidos (D) | 1 backup ≈ | 14 backups retidos ≈ | Situação |
| --- | --- | --- | --- |
| 0 (hoje) | 0,6 MB | **≈ 8 MB** | folga enorme |
| 100 MB | 101 MB | 1,4 GB | confortável |
| 500 MB | 501 MB | 7,0 GB | no limite do orçamento de 8 GiB |
| 1 GB | 1 GB | — | o orçamento passa a **cortar** retenção (mínimo 3); avisar; mudar a estratégia |
| > 2,5 GB | — | — | **não cabe** em 15 GB: separar os documentos (backup incremental) antes de chegar aqui |

## 3. Política de retenção proposta
- **Destino (Drive):** o backup mais recente de cada um dos **últimos 7 dias**, **4 semanas** e **3 meses** → no máximo ~14 cópias; **nunca menos que 3**.
- **Orçamento de bytes:** `BACKUP_REMOTE_MAX_BYTES` = **8 GiB** para estes backups (de 14,95 GB livres). Passou disso, apaga-se o mais antigo (preservando 3
  e o recém-enviado) e sai um aviso.
- **Folga:** o envio só acontece se sobrar **1 GiB livre** depois dele (`BACKUP_REMOTE_MIN_FREE_BYTES`). Os 15 GB são **compartilhados com Gmail e
  Google Fotos**: o espaço livre pode encolher por motivos alheios ao backup, por isso a checagem é feita *a cada* execução e o vigia alerta.
- **Local (VPS):** 14 dias, preservando 3; backups com envio pendente **nunca** são apagados.
- **Remoção de verdade:** toda remoção no Drive usa `--drive-use-trash=false`. Sem isso o arquivo vai para a **lixeira, que continua ocupando a cota**.
  O script **nunca** usa `rclone cleanup` (ele esvaziaria a lixeira da conta inteira).

## 4. Segurança da configuração do Drive
- **Escopo `drive.file`** (documentação do rclone: "read/view/modify only those files and folders it creates"): mesmo com o token vazado, o resto do seu
  Drive (fotos, documentos pessoais) fica **inacessível**. A pasta `vastaflow-backups` é criada pelo próprio rclone (não use uma pasta criada à mão).
  Consequência: **não troque o `client_id`** depois de começar (os arquivos antigos deixariam de ser visíveis ao novo cliente); guarde-o no cofre de senhas.
- **Credenciais OAuth próprias** (a documentação atual do rclone trata o client_id compartilhado como em aposentadoria em 2026).
- **Publicar o app OAuth ("Em produção")**: no modo "Testing" a documentação do rclone avisa que "any grants will expire after a week" — o backup
  pararia sozinho depois de 7 dias. O Google mostrará o aviso "app não verificado" ao autorizar; é esperado para uso próprio.
- **Nada de segredo no chat ou no Git:** o arquivo real `rclone.conf` (com `client_secret` e o token) existe **só** na VPS, modo 600, e está no `.gitignore`.
  O modelo sem segredos é `infra/backup/rclone.conf.example`. O token do bot de alerta e a chave do heartbeat ficam em `/etc/vastaflow/backup.env` (600).
- **Conta Google:** ative verificação em duas etapas; considere uma conta **dedicada** (mais fácil de proteger e de transferir à cliente). Dados de
  cliente (LGPD) ficam no Drive **cifrados**, mas a decisão de usar uma conta pessoal provisória é sua.
- **Risco de dependência:** o Drive é um serviço de terceiros; perder a conta Google = perder esta cópia. Por isso: manter também a cópia local da VPS e
  fazer, de tempos em tempos, uma cópia manual para um disco offline.

## 5. Chave GPG de recuperação (fora da VPS)
A chave **privada** é a única forma de restaurar. Ela **nunca** vai para a VPS nem para o Drive.
```bash
# NO SEU COMPUTADOR (Git Bash/Linux/macOS):
gpg --quick-generate-key "backup-vastaflow <seu-email>" rsa4096 encr 5y     # será pedida uma FRASE-SENHA forte (guarde no cofre de senhas)
gpg --list-keys --fingerprint backup-vastaflow                                # anote a IMPRESSÃO DIGITAL (40 hex): vai em BACKUP_GPG_RECIPIENT
gpg --armor --export <FINGERPRINT> > backup-publica.asc                       # a única que vai para a VPS
gpg --armor --export-secret-keys <FINGERPRINT> > backup-privada.asc           # PRIVADA: veja abaixo
gpg --gen-revoke <FINGERPRINT> > backup-revogacao.asc                         # certificado de revogação (guarde junto)
```
- Guarde `backup-privada.asc` + `backup-revogacao.asc` + a frase-senha em **dois lugares independentes**: (1) cofre de senhas com anexo; (2) pendrive
  **offline** num local físico seguro (ou impresso com `paperkey`). **Nunca** os dois no mesmo lugar nem no mesmo Google Drive dos backups.
- **Prove que a recuperação funciona antes de confiar:** num computador *sem* a sua chave (ou em uma pasta `GNUPGHOME` limpa), importe a cópia de backup da
  privada, decifre um arquivo de teste e confira. O `scripts/restore-test.sh` faz essa prova com uma chave descartável.
- Na VPS: `gpg --import backup-publica.asc` (só a pública) e `BACKUP_GPG_RECIPIENT=<FINGERPRINT>` no `backup.env`. Depois **apague** os `.asc` da VPS.
- A chave tem validade (5 anos): coloque o lembrete no calendário; ao renovar, mantenha a antiga enquanto houver backups cifrados com ela.

## 6. Configuração necessária (resumo)
| Onde | O quê |
| --- | --- |
| `/etc/vastaflow/backup.env` (VPS, 600) | `BACKUP_GPG_RECIPIENT`, `BACKUP_REMOTE=gdrive:vastaflow-backups`, limites (seção 3), `BACKUP_ALERT_TELEGRAM_*` e/ou `BACKUP_HEARTBEAT_URL` — modelo em `infra/backup/backup.env.example` |
| `~/.config/rclone/rclone.conf` (VPS, 600) | remoto `gdrive` (tipo `drive`, `scope = drive.file`, client_id/secret **seus**, token) — modelo em `infra/backup/rclone.conf.example` |
| `/etc/systemd/system/` | `vastaflow-backup.{service,timer}` (03:30), `vastaflow-backup-alert.service`, `vastaflow-backup-watchdog.{service,timer}` (09:00) — em `infra/backup/` |
| VPS | `rclone` (pacote oficial: baixe o `.deb`/zip em downloads.rclone.org e **confira o SHA256SUMS** da versão; evite `curl | bash`) e `gnupg` |

## 7. Alertas e o que fazer quando chegam
| Alerta | Significado | O que fazer |
| --- | --- | --- |
| `FALHA ... destino_inalcancavel` | rclone não falou com o Drive (rede, token revogado/expirado) | `rclone lsd gdrive:` na VPS; se pedir login, refazer a autorização (seção 8, passo 4); o envio pendente sai sozinho depois |
| `FALHA ... sem_espaco_no_destino` | Drive sem 1 GiB livre além do backup | liberar espaço (Gmail/Fotos/Lixeira da conta) ou reduzir `BACKUP_REMOTE_MAX_BYTES`; conferir `rclone about gdrive:` |
| `FALHA ... backup_maior_que_o_orcamento` | um backup sozinho passa de 8 GiB | rever os documentos (seção 2) |
| `AVISO retencao reduzida pelo orcamento` | o orçamento forçou apagar cópias antigas | avaliar espaço/estratégia dos documentos |
| `AVISO backup grande` | um backup passou de 500 MB | conferir se entraram documentos novos grandes |
| `FALHA vigia: backup_local_atrasado_Nh` | o agendador não rodou | `systemctl status vastaflow-backup.timer`; `journalctl -u vastaflow-backup` |
| `FALHA vigia: envios_pendentes_N` | há backup local sem cópia externa | resolver a causa acima; o próximo backup reenvia |
| silêncio total | o próprio alerta pode ter falhado | o `heartbeat` externo (healthchecks.io ou similar) avisa quando o backup **não** chega a rodar — recomendado |

## 8. Passos manuais restantes (nada abaixo foi feito)
1. **Você:** gerar a chave GPG (seção 5), guardar a privada em 2 lugares, testar a recuperação.
2. **Você:** no Google Cloud Console (na conta que guardará os backups): criar um projeto, ativar a **Google Drive API**, configurar a tela de consentimento
   (externa), criar credencial **OAuth "Desktop app"**, **publicar o app** ("Em produção"). Copiar *client id* e *client secret* para o cofre de senhas.
3. **Você:** instalar o rclone (versão oficial) no seu computador e rodar `rclone config`: novo remoto `gdrive`, tipo `drive`, cole client id/secret (do cofre), **escopo = `drive.file`**,
   deixar `root_folder_id` vazio, autenticar no navegador. Testar com `rclone mkdir gdrive:vastaflow-backups` e `rclone lsd gdrive:`.
   **Eu só autentico o rclone com a sua autorização expressa; não conecto a sua conta Google por conta própria.**
4. **Você:** levar o `rclone.conf` à VPS **por `scp`** (modo 600), nunca por chat.
5. **Teste controlado COM O DRIVE, só com dados fictícios** (com sua autorização): `RT_REMOTE=1 RT_REMOTE_TARGET=gdrive:vastaflow-teste-restauracao bash scripts/restore-test.sh`
   (cria uma stack descartável com dados sintéticos, envia ao Drive, **apaga a cópia local**, baixa do Drive, restaura e confere pela API; remove a pasta de teste do Drive no fim).
6. Configurar `backup.env` (seção 6), instalar as unidades do systemd, rodar `systemctl start vastaflow-backup.service` **uma vez à mão** e conferir `rclone lsf gdrive:vastaflow-backups`.
7. **Simular falhas** antes de confiar: desconectar o remoto (renomear temporariamente) e ver o alerta chegar; conferir que o backup local permaneceu.
8. Fazer uma **restauração real do primeiro backup do Drive** num ambiente separado (`scripts/backup-fetch.sh latest <pasta>` + `scripts/restore.sh`).

## 9. Condições para ativar o backup real (checklist)
- [ ] Chave GPG gerada; privada guardada em 2 lugares; recuperação testada.
- [ ] App OAuth **publicado**; client id/secret no cofre; escopo `drive.file`.
- [ ] Teste controlado com dados fictícios (passo 5) passou **contra o Drive**.
- [ ] Alertas configurados e um alerta de falha **recebido de verdade** (passo 7).
- [ ] Primeira restauração real do Drive feita em ambiente separado.
- [ ] Sua autorização explícita para enviar dados reais (cifrados) ao Drive.

## 10. O que já foi testado (e o que não)
- **Testado (local, sem Google):** `infra/backup/test-remote.sh` — 53 verificações: envio com conferência de hash; arquivo adulterado no destino é detectado e o
  download é recusado; falha de envio preserva o backup local e deixa pendência que é reenviada; destino inalcançável, sem espaço e backup maior que o orçamento
  são recusados; retenção por faixas (função pura) e poda por orçamento sem nunca apagar o mais novo nem ficar abaixo do mínimo; recusa de apagar quando a listagem falha;
  alertas (token só vai ao servidor, nunca na saída, mensagens com aspas/quebra de linha, supressão de duplicados, heartbeat); vigia (sem backup, atrasado, pendente,
  ausente no destino). `RT_REMOTE=1 scripts/restore-test.sh` — backup real da stack sintética → destino → cópia local apagada → download → restauração → API confere.
- **NÃO testado:** autenticação OAuth, cota e limites reais do Google Drive, o comportamento de `about`/`size` do Drive, a expiração de token, o envio de alertas ao
  Telegram real, o heartbeat real, rclone em Linux/VPS.
