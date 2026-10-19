#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - ENSAIO de recuperacao da chave GPG dos backups. Dados 100% FICTICIOS.
# ---------------------------------------------------------------------------
#   bash scripts/gpg-recovery-drill.sh
#       Cria uma chave DESCARTAVEL (frase-senha aleatoria, valida por 1 dia) e simula as 3 "maquinas":
#       (1) a maquina onde a chave nasce, (2) a VPS (so a chave PUBLICA) e (3) uma maquina limpa de recuperacao.
#       Prova: a VPS cifra mas NAO decifra; a maquina limpa, so com o arquivo da privada + a frase-senha, decifra e o
#       conteudo e identico; frase-senha errada nao abre; o arquivo exportado da privada esta PROTEGIDO por frase-senha.
#
#   bash scripts/gpg-recovery-drill.sh verify-real <IMPRESSAO_DIGITAL> <backup-privada.asc> [backup-publica.asc]
#       Confere a SUA chave real, a partir do arquivo de backup dela (o de cada local seguro), numa pasta temporaria
#       limpa e com um texto FICTICIO. A frase-senha e pedida pelo pinentry (janela) - nunca por argumento nem arquivo.
#
# Nunca imprime chave, frase-senha ou conteudo; so linhas ok/FALHA. Nao toca no seu chaveiro (usa pastas temporarias).
# ===========================================================================
set -uo pipefail
umask 077
export MSYS_NO_PATHCONV=1
command -v gpg >/dev/null || { echo "ERRO: gpg nao encontrado." >&2; exit 2; }

TMP="$(mktemp -d)"
HOMES=()
newhome() { local h="$TMP/$1"; mkdir -p "$h"; chmod 700 "$h"; HOMES+=("$h"); printf '%s' "$h"; }
cleanup() {
  for h in "${HOMES[@]:-}"; do [ -n "$h" ] && gpgconf --homedir "$h" --kill gpg-agent >/dev/null 2>&1; done
  sleep 1; rm -rf "$TMP"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1"; }
G() { local h="$1"; shift; gpg --homedir "$h" --batch --yes --quiet "$@"; }                  # sem frase-senha
GP() { local h="$1" pf="$2"; shift 2; gpg --homedir "$h" --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$pf" "$@"; }

SECRET_TEXT="texto-ficticio-$(openssl rand -hex 12)"      # NAO e dado real: serve so para provar a decifragem
printf '%s\n' "$SECRET_TEXT" > "$TMP/ficticio.txt"
sha() { sha256sum "$1" | cut -d' ' -f1; }

# ----------------------------------------------------------------------------------------------------------------
if [ "${1:-}" = "verify-real" ]; then
  FPR="${2:-}"; PRIV="${3:-}"; PUB="${4:-}"
  [[ "$FPR" =~ ^[0-9A-Fa-f]{40}$ ]] || { echo "uso: $0 verify-real <impressao digital de 40 hex> <backup-privada.asc> [backup-publica.asc]" >&2; exit 2; }
  [ -f "$PRIV" ] || { echo "ERRO: arquivo da privada nao encontrado." >&2; exit 2; }
  echo "== Conferencia da chave REAL em pasta temporaria limpa (texto ficticio; a frase-senha sera pedida na janela)"
  R="$(newhome recuperacao)"
  if G "$R" --import "$PRIV" 2>/dev/null; then ok "o arquivo da privada importa numa maquina limpa"; else bad "o arquivo da privada nao importou"; fi
  GOT="$(gpg --homedir "$R" --batch --with-colons --list-secret-keys 2>/dev/null | awk -F: '/^fpr/ {print toupper($10); exit}')"
  [ "$GOT" = "$(echo "$FPR" | tr a-f A-F)" ] && ok "a impressao digital do arquivo confere com a informada" || bad "a impressao digital do arquivo NAO confere"
  G "$R" --trust-model always --recipient "$FPR" --output "$TMP/ficticio.gpg" --encrypt "$TMP/ficticio.txt" && ok "cifrou o texto ficticio com a chave" || bad "nao cifrou"
  [ -n "${VERIFY_PASSPHRASE_FILE:-}" ] || echo "  (agora a janela pedira a frase-senha para DECIFRAR o texto ficticio)"
  # VERIFY_PASSPHRASE_FILE existe SO para o ensaio automatico (modo sem janela); na sua chave real nao use: deixe o pinentry pedir.
  DEC=(gpg --homedir "$R" --yes --quiet)
  [ -z "${VERIFY_PASSPHRASE_FILE:-}" ] || DEC+=(--batch --pinentry-mode loopback --passphrase-file "$VERIFY_PASSPHRASE_FILE")
  if "${DEC[@]}" --output "$TMP/ficticio.out" --decrypt "$TMP/ficticio.gpg" 2>/dev/null && [ "$(sha "$TMP/ficticio.out")" = "$(sha "$TMP/ficticio.txt")" ]; then
    ok "a frase-senha abre a chave e o texto ficticio volta identico"
  else bad "NAO conseguiu decifrar (frase-senha errada ou arquivo corrompido)"; fi
  if [ -n "$PUB" ]; then
    P="$(newhome publica)"
    if G "$P" --import "$PUB" 2>/dev/null; then ok "o arquivo da chave PUBLICA importa"; else bad "a chave publica nao importou"; fi
    GOTP="$(gpg --homedir "$P" --batch --with-colons --list-keys 2>/dev/null | awk -F: '/^fpr/ {print toupper($10); exit}')"
    [ "$GOTP" = "$(echo "$FPR" | tr a-f A-F)" ] && ok "a publica tem a MESMA impressao digital" || bad "a publica tem outra impressao digital"
    gpg --homedir "$P" --batch --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec' && bad "o arquivo PUBLICO contem chave privada!" || ok "o arquivo publico NAO contem chave privada"
  fi
  echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
  [ "$FAIL" -eq 0 ]; exit
fi

# ----------------------------------------------------------------------------------------------------------------
echo "== Ensaio com chave DESCARTAVEL e dados FICTICIOS"
openssl rand -hex 24 > "$TMP/frase.txt"; openssl rand -hex 24 > "$TMP/frase-errada.txt"
: > "$TMP/vazia.txt"

echo "-- (1) maquina onde a chave nasce"
GEN="$(newhome geracao)"
if GP "$GEN" "$TMP/frase.txt" --quick-generate-key "drill-vastaflow <drill@vastaflow.invalid>" rsa3072 encr 1d 2>/dev/null; then ok "chave RSA 3072 gerada (frase-senha aleatoria, validade 1 dia)"; else bad "nao gerou a chave"; exit 1; fi
FPR="$(gpg --homedir "$GEN" --batch --with-colons --list-keys 2>/dev/null | awk -F: '/^fpr/ {print $10; exit}')"
[[ "$FPR" =~ ^[0-9A-F]{40}$ ]] && ok "impressao digital de 40 hex (${FPR:0:8}...)" || bad "impressao digital invalida"
G "$GEN" --armor --export "$FPR" > "$TMP/publica.asc" && ok "chave PUBLICA exportada" || bad "exportacao publica falhou"
GP "$GEN" "$TMP/frase.txt" --armor --export-secret-keys "$FPR" > "$TMP/privada.asc" && ok "chave PRIVADA exportada (arquivo protegido por frase-senha)" || bad "exportacao privada falhou"
grep -q "BEGIN PGP PRIVATE KEY BLOCK" "$TMP/privada.asc" && ok "o arquivo da privada e um bloco PGP privado" || bad "formato inesperado"
if printf 'y\n0\n\ny\n' | gpg --homedir "$GEN" --yes --quiet --pinentry-mode loopback --passphrase-file "$TMP/frase.txt" --command-fd 0 --output "$TMP/revogacao.asc" --gen-revoke "$FPR" >/dev/null 2>&1 && grep -q "BEGIN PGP PUBLIC KEY BLOCK" "$TMP/revogacao.asc"; then
  ok "certificado de revogacao gerado"
else
  echo "  aviso - certificado de revogacao nao gerado em modo automatico (gere manualmente na sua chave real: ver docs/backup-google-drive.md)"
fi

echo "-- (2) a 'VPS': so a chave PUBLICA"
VPS="$(newhome vps)"
G "$VPS" --import "$TMP/publica.asc" 2>/dev/null && ok "a VPS importa so a publica" || bad "importacao na VPS falhou"
G "$VPS" --trust-model always --recipient "$FPR" --output "$TMP/backup.gpg" --encrypt "$TMP/ficticio.txt" && ok "a VPS CIFRA o backup ficticio" || bad "a VPS nao cifrou"
grep -qF "$SECRET_TEXT" "$TMP/backup.gpg" && bad "texto em claro dentro do arquivo cifrado" || ok "o arquivo cifrado nao contem o texto em claro"
gpg --homedir "$VPS" --batch --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec' && bad "a VPS tem chave privada!" || ok "a VPS nao tem chave privada"
G "$VPS" --output "$TMP/vps.out" --decrypt "$TMP/backup.gpg" 2>/dev/null && bad "a VPS conseguiu decifrar!" || ok "a VPS NAO consegue decifrar (e o que se quer)"

echo "-- (3) maquina LIMPA de recuperacao: so com privada.asc + frase-senha"
REC="$(newhome recuperacao)"
GP "$REC" "$TMP/frase.txt" --import "$TMP/privada.asc" 2>/dev/null && ok "importa a privada a partir do arquivo" || bad "importacao da privada falhou"
if GP "$REC" "$TMP/frase.txt" --output "$TMP/recuperado.txt" --decrypt "$TMP/backup.gpg" 2>/dev/null && [ "$(sha "$TMP/recuperado.txt")" = "$(sha "$TMP/ficticio.txt")" ]; then
  ok "decifra o backup e o conteudo e IDENTICO (sha256)"; else bad "recuperacao falhou"; fi
rm -f "$TMP/recuperado.txt"
# Cada tentativa errada usa uma maquina LIMPA nova: o gpg-agent guarda a frase-senha certa por minutos e mascararia o teste.
for tentativa in errada vazia; do
  W="$(newhome "recuperacao-$tentativa")"
  F="$TMP/frase-errada.txt"; [ "$tentativa" = vazia ] && F="$TMP/vazia.txt"
  G "$W" --import "$TMP/privada.asc" 2>/dev/null
  GP "$W" "$F" --output "$TMP/errado.txt" --decrypt "$TMP/backup.gpg" 2>/dev/null && bad "frase-senha ${tentativa} abriu a chave!" || ok "frase-senha ${tentativa} NAO abre (a privada exportada esta protegida)"
done

echo "-- (4) adulteracao do backup cifrado"
cp "$TMP/backup.gpg" "$TMP/backup-adulterado.gpg"; printf 'X' | dd of="$TMP/backup-adulterado.gpg" bs=1 seek=200 conv=notrunc 2>/dev/null
GP "$REC" "$TMP/frase.txt" --output "$TMP/adulterado.out" --decrypt "$TMP/backup-adulterado.gpg" 2>/dev/null && bad "backup adulterado foi aceito" || ok "backup adulterado e RECUSADO na decifragem (integridade do gpg)"

echo "-- (5) o modo 'verify-real' (o que voce usara na chave de verdade), exercitado com a chave descartavel"
if VERIFY_PASSPHRASE_FILE="$TMP/frase.txt" bash "$0" verify-real "$FPR" "$TMP/privada.asc" "$TMP/publica.asc" >"$TMP/verify.out" 2>&1; then ok "verify-real passou com os arquivos de backup da chave descartavel ($(grep -c '  ok' "$TMP/verify.out") verificacoes)"; else bad "verify-real falhou: $(grep FALHA "$TMP/verify.out" | head -2 | tr '
' ' ')"; fi
VERIFY_PASSPHRASE_FILE="$TMP/frase-errada.txt" bash "$0" verify-real "$FPR" "$TMP/privada.asc" >/dev/null 2>&1 && bad "verify-real aceitou frase-senha errada" || ok "verify-real REPROVA com frase-senha errada"
VERIFY_PASSPHRASE_FILE="$TMP/frase.txt" bash "$0" verify-real "0000000000000000000000000000000000000000" "$TMP/privada.asc" >/dev/null 2>&1 && bad "verify-real aceitou impressao digital errada" || ok "verify-real REPROVA com impressao digital errada"

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ] && echo "ENSAIO DE RECUPERACAO: PASS" || { echo "ENSAIO DE RECUPERACAO: FALHA"; exit 1; }
