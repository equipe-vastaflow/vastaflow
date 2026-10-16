#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - primeira emissao do certificado HTTPS (Let's Encrypt, HTTP-01).
# Rode NA VPS, depois de o DNS de SERVER_NAME apontar para ela e de as portas 80/443 estarem abertas.
#
#   SERVER_NAME=app.exemplo.com.br LETSENCRYPT_EMAIL=voce@exemplo.com.br ./scripts/https-init.sh
#   STAGING=1 ...        ensaio contra o ambiente de teste do Let's Encrypt (sem limite de taxa)
#
# Por que o passo do certificado temporario: o nginx nao sobe sem o certificado, e o certbot precisa do
# nginx no ar para validar o dominio. Cria-se um certificado AUTOASSINADO de 1 dia, sobe-se o nginx,
# emite-se o certificado real e recarrega-se. Idempotente: se ja houver certificado real, nao faz nada.
# Nao grava segredo algum: a chave privada fica no volume vastaflow-letsencrypt, nunca no repositorio.
# ===========================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.production.yml -f docker-compose.https.yml)

# O .env do servidor (fora do Git) fornece SERVER_NAME/LETSENCRYPT_EMAIL se nao vierem do ambiente.
if [ -f .env ]; then
  for key in SERVER_NAME LETSENCRYPT_EMAIL; do
    if [ -z "${!key:-}" ]; then
      value="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- || true)"
      [ -n "$value" ] && export "$key=$value"
    fi
  done
fi

: "${SERVER_NAME:?defina SERVER_NAME (dominio) no .env ou no ambiente}"
: "${LETSENCRYPT_EMAIL:?defina LETSENCRYPT_EMAIL no .env ou no ambiente}"

# Recusa valores que claramente nao sao um dominio real (evita gastar tentativas do Let's Encrypt).
if ! [[ "$SERVER_NAME" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
  echo "ERRO: SERVER_NAME invalido: use um nome de dominio em minusculas, sem http:// nem barra." >&2
  exit 2
fi
case "$SERVER_NAME" in
  *.example|*.invalid|*.test|*.localhost|exemplo.*|*.exemplo.*|example.*|*.example.*)
    if [ "${ALLOW_PLACEHOLDER_DOMAIN:-0}" != "1" ]; then
      echo "ERRO: SERVER_NAME parece um dominio ficticio. O Let's Encrypt recusaria." >&2
      exit 2
    fi ;;
esac

CERT_VOLUME="vastaflow-letsencrypt"
LIVE="/etc/letsencrypt/live/${SERVER_NAME}"

has_real_cert() {
  docker run --rm -v "${CERT_VOLUME}:/etc/letsencrypt:ro" alpine:3.20 \
    sh -c "test -f '${LIVE}/fullchain.pem' && ! test -f '${LIVE}/.vastaflow-temporario'" 2>/dev/null
}

if has_real_cert; then
  echo "Certificado real ja existe para ${SERVER_NAME}. Nada a fazer (renovacao e automatica)."
  exit 0
fi

echo "1/4 Certificado temporario (autoassinado, 1 dia) para o nginx conseguir subir..."
docker volume create "${CERT_VOLUME}" >/dev/null
docker run --rm -v "${CERT_VOLUME}:/etc/letsencrypt" alpine:3.20 sh -c "
  apk add --no-cache openssl >/dev/null &&
  mkdir -p '${LIVE}' &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=${SERVER_NAME}' \
    -keyout '${LIVE}/privkey.pem' -out '${LIVE}/fullchain.pem' 2>/dev/null &&
  touch '${LIVE}/.vastaflow-temporario'"

echo "2/4 Subindo o nginx..."
"${COMPOSE[@]}" up -d nginx

echo "3/4 Emitindo o certificado real${STAGING:+ (STAGING: nao e confiavel pelos navegadores)}..."
docker run --rm -v "${CERT_VOLUME}:/etc/letsencrypt" alpine:3.20 sh -c "
  rm -rf '/etc/letsencrypt/live/${SERVER_NAME}' '/etc/letsencrypt/archive/${SERVER_NAME}' \
         '/etc/letsencrypt/renewal/${SERVER_NAME}.conf'"
"${COMPOSE[@]}" run --rm --no-deps --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "${SERVER_NAME}" \
  --email "${LETSENCRYPT_EMAIL}" --agree-tos --no-eff-email --non-interactive \
  ${STAGING:+--staging}

echo "4/4 Recarregando o nginx com o certificado real..."
"${COMPOSE[@]}" exec -T nginx nginx -s reload
"${COMPOSE[@]}" up -d certbot
echo "Pronto. Teste: curl -sI https://${SERVER_NAME}/nginx-health  (a renovacao e automatica)"
