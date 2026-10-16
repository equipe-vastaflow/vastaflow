#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - teste ISOLADO da configuracao HTTPS/Nginx (nao toca a stack em execucao).
# ---------------------------------------------------------------------------
# Sobe, numa rede Docker descartavel e SEM portas publicadas no host:
#   - um backend FALSO (ecoa o que recebeu), com o alias `backend`;
#   - o nginx oficial com os arquivos REAIS deste repositorio (conf.d, snippets, modelo HTTPS), em dois
#     modos: HTTP (padrao local) e HTTPS (certificado autoassinado ficticio);
#   - um cliente curl na mesma rede.
# NAO testa: emissao de certificado no Let's Encrypt (exige dominio e DNS reais). Ver docs/deploy-vps.md.
#
#   bash infra/https/test-https.sh        (exit 0 = tudo passou)
# ===========================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash no Windows nao pode reescrever caminhos de container

cd "$(dirname "$0")/../.."
P="vf-https-test"
NET="${P}-net"
# Nome no formato DuckDNS: prova que o modelo nao exige dominio pago. Outro nome: DOMAIN=... bash test-https.sh
DOMAIN="${DOMAIN:-vastaflow.duckdns.org}"
# Segredos SINTETICOS do backend falso (imitam App Secret e token de verificacao do WhatsApp).
WA_SECRET="segredo-sintetico-do-app-$(openssl rand -hex 8)"
WA_VERIFY="token-sintetico-de-verificacao-$(openssl rand -hex 8)"
NGINX_IMAGE="nginx:1.30.5-alpine"
CURL_IMAGE="curlimages/curl:8.10.1"
PASS=0; FAIL=0

cleanup() {
  docker rm -f "${P}-backend" "${P}-https" "${P}-http" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "${P}-certs" "${P}-webroot" "${P}-html" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FALHA- $1  [$2]"; }
check() { # check "descricao" "esperado (grep -E)" "obtido"
  if printf '%s' "$3" | grep -qiE -- "$2"; then ok "$1"; else bad "$1" "esperado /$2/, obtido: $(printf '%s' "$3" | head -c 160 | tr '\n' ' ')"; fi
}
refute() { # refute "descricao" "padrao que NAO pode aparecer" "obtido"
  if printf '%s' "$3" | grep -qiE -- "$2"; then bad "$1" "apareceu /$2/"; else ok "$1"; fi
}

echo "Preparando rede, volumes e imagens..."
docker network create "$NET" >/dev/null
docker volume create "${P}-certs" >/dev/null
docker volume create "${P}-webroot" >/dev/null
docker volume create "${P}-html" >/dev/null
docker pull -q "$NGINX_IMAGE" >/dev/null
docker pull -q "$CURL_IMAGE" >/dev/null
docker pull -q alpine:3.20 >/dev/null

# Certificado autoassinado FICTICIO + paginas de teste.
docker run --rm -v "${P}-certs:/etc/letsencrypt" -v "${P}-webroot:/var/www/certbot" -v "${P}-html:/html" alpine:3.20 sh -c "
  apk add --no-cache openssl >/dev/null &&
  mkdir -p /etc/letsencrypt/live/${DOMAIN} /var/www/certbot/.well-known/acme-challenge /html/assets &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=${DOMAIN}' \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem 2>/dev/null &&
  echo desafio-acme-ok > /var/www/certbot/.well-known/acme-challenge/probe &&
  echo '<html>spa-index</html>' > /html/index.html && echo 'console.log(1)' > /html/assets/app-abc.js"

# Backend falso: responde JSON com o que viu. Alias de rede `backend`, porta 3000 (como no Compose).
FAKE_BACKEND='
const http = require("http");
const crypto = require("crypto");
http.createServer((q, r) => {
  const chunks = [];
  q.on("data", (c) => chunks.push(c));
  q.on("end", () => {
    const body = Buffer.concat(chunks);
    const url = new URL(q.url, "http://x");
    let status = 200;
    let sigOk = null;
    if (url.pathname === "/webhooks/whatsapp") {
      if (q.method === "POST") {
        // Imita o contrato do backend real: HMAC-SHA256 do corpo BRUTO com o App Secret; sem assinatura valida = 403.
        const want = "sha256=" + crypto.createHmac("sha256", process.env.WA_SECRET).update(body).digest("hex");
        const got = String(q.headers["x-hub-signature-256"] || "");
        sigOk = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
        if (!sigOk) status = 403;
      } else if (q.method === "GET") {
        if (url.searchParams.get("hub.verify_token") !== process.env.WA_VERIFY) status = 403;
      }
    }
    r.statusCode = status;
    r.setHeader("content-type", "application/json");
    r.end(JSON.stringify({ method: q.method, url: q.url, bytes: body.length, sigOk,
      xff: q.headers["x-forwarded-for"] || null, proto: q.headers["x-forwarded-proto"] || null }));
  });
}).listen(3000);'
docker run -d --name "${P}-backend" --network "$NET" --network-alias backend -e "WA_SECRET=${WA_SECRET}" -e "WA_VERIFY=${WA_VERIFY}" node:24.15.0-bookworm-slim node -e "$FAKE_BACKEND" >/dev/null

# Como na imagem real: arquivos individuais (conf.d precisa continuar gravavel para o envsubst) e sem o
# default.conf do nginx (o Dockerfile o remove).
CONF=(-v "$PWD/frontend/nginx/conf.d/00-rate-limit.conf:/etc/nginx/conf.d/00-rate-limit.conf:ro"
      -v "$PWD/frontend/nginx/conf.d/01-log-format.conf:/etc/nginx/conf.d/01-log-format.conf:ro"
      -v "$PWD/frontend/nginx/conf.d/02-hsts.conf:/etc/nginx/conf.d/02-hsts.conf:ro"
      -v "$PWD/frontend/nginx/snippets:/etc/nginx/snippets:ro" -v "${P}-html:/usr/share/nginx/html:ro")
START=(sh -c "rm -f /etc/nginx/conf.d/default.conf; exec /docker-entrypoint.sh nginx -g 'daemon off;'")

# --- modo HTTPS (o que a VPS usa) ---
docker run -d --name "${P}-https" --network "$NET" "${CONF[@]}" \
  -v "$PWD/infra/https/vastaflow-https.conf.template:/etc/nginx/templates/10-https.conf.template:ro" \
  -v "$PWD/infra/https/vastaflow-http-disabled.conf:/etc/nginx/conf.d/vastaflow.conf:ro" \
  -v "${P}-certs:/etc/letsencrypt:ro" -v "${P}-webroot:/var/www/certbot:ro" \
  -e "SERVER_NAME=${DOMAIN}" -e 'NGINX_ENVSUBST_FILTER=^SERVER_NAME$' -e 'NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d' \
  "$NGINX_IMAGE" >/dev/null
# --- modo HTTP (padrao local, sem dominio) ---
docker run -d --name "${P}-http" --network "$NET" "${CONF[@]}"   -v "$PWD/frontend/nginx/conf.d/vastaflow.conf:/etc/nginx/conf.d/vastaflow.conf:ro"   "$NGINX_IMAGE" "${START[@]}" >/dev/null
sleep 4

c() { docker run --rm -i --network "$NET" "$CURL_IMAGE" -s --max-time 10 "$@"; }
ip_of() { docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$1"; }
HTTPS_IP="$(ip_of "${P}-https")"
HTTP_IP="$(ip_of "${P}-http")"
H="https://${DOMAIN}"
R=(--resolve "${DOMAIN}:443:${HTTPS_IP}" -k)

echo; echo "== configuracao carregou"
check "nginx -t (modo HTTPS)" "successful" "$(docker exec "${P}-https" nginx -t 2>&1)"
check "nginx -t (modo HTTP)"  "successful" "$(docker exec "${P}-http" nginx -t 2>&1)"
RENDERED="$(docker exec "${P}-https" cat /etc/nginx/conf.d/10-https.conf | grep -v '^[[:space:]]*#')"
check "modelo renderizou o dominio no certificado" "live/${DOMAIN}/fullchain.pem" "$RENDERED"
refute "nenhuma variavel de modelo ficou sem substituir" '[$][{]SERVER_NAME[}]' "$RENDERED"
check "variaveis do nginx preservadas (host)" 'return 301 https://[$]host[$]request_uri' "$RENDERED"
ALLCONF="$RENDERED$(docker exec "${P}-https" cat /etc/nginx/snippets/vastaflow-app.conf | grep -v '^[[:space:]]*#')"
refute "ingress nao conhece n8n, MySQL nem PostgreSQL" '5678|3306|5432|n8n|mysql|postgres' "$ALLCONF"

echo; echo "== porta 80 (HTTPS): so desafio ACME e redirecionamento"
check "GET / -> 301 para https"             "301 https://${DOMAIN}/" "$(c -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: ${DOMAIN}" "http://${HTTPS_IP}/")"
check "redirecionamento preserva caminho e query" "https://${DOMAIN}/api/x[?]a=1" "$(c -o /dev/null -w '%{redirect_url}' -H "Host: ${DOMAIN}" "http://${HTTPS_IP}/api/x?a=1")"
check "desafio ACME servido do webroot"     "desafio-acme-ok" "$(c -H "Host: ${DOMAIN}" "http://${HTTPS_IP}/.well-known/acme-challenge/probe")"
check "nginx-health responde na :80"        "ok" "$(c -H "Host: ${DOMAIN}" "http://${HTTPS_IP}/nginx-health")"
check "API NAO e servida em HTTP puro"      "301" "$(c -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" "http://${HTTPS_IP}/api/health")"

echo; echo "== TLS e cabecalhos (:443)"
check "HTTP/2 negociado"                    "^2$" "$(c "${R[@]}" -o /dev/null -w '%{http_version}' "${H}/")"
check "TLS 1.2 ou 1.3"                      "TLSv1[.][23]" "$(c "${R[@]}" -v -o /dev/null "${H}/" 2>&1 | grep -iE 'SSL connection|TLSv' || true)"
check "TLS 1.1 e anterior recusados (sem resposta HTTP)" "^000$" "$(c "${R[@]}" --tls-max 1.1 -o /dev/null -w '%{http_code}' "${H}/" 2>/dev/null)"
HDR="$(c "${R[@]}" -D - -o /dev/null "${H}/")"
check "HSTS presente em HTTPS"              "strict-transport-security: max-age=" "$HDR"
check "CSP presente"                        "content-security-policy: default-src 'self'" "$HDR"
check "nosniff presente"                    "x-content-type-options: nosniff" "$HDR"
check "X-Frame-Options DENY"                "x-frame-options: DENY" "$HDR"
refute "versao do nginx nao anunciada"      "server: nginx/[0-9]" "$HDR"
check "HSTS tambem nos assets (location propria)" "strict-transport-security" "$(c "${R[@]}" -D - -o /dev/null "${H}/assets/app-abc.js")"
check "SPA: rota do cliente cai no index.html" "spa-index" "$(c "${R[@]}" "${H}/finance/relatorios")"

echo; echo "== superficie publica"
check "/api/service/* -> 404"               "404" "$(c "${R[@]}" -o /dev/null -w '%{http_code}' "${H}/api/service/identity")"
check "/api/Service/* (caixa) -> 404"       "404" "$(c "${R[@]}" -o /dev/null -w '%{http_code}' "${H}/api/Service/identity")"
check "/api/%73ervice (codificado) -> 404"  "404" "$(c "${R[@]}" -o /dev/null -w '%{http_code}' "${H}/api/%73ervice/identity")"
check "/api/health/readiness -> 403"        "403" "$(c "${R[@]}" -o /dev/null -w '%{http_code}' "${H}/api/health/readiness")"
check "API comum chega ao backend sem o prefixo /api" '"url":"/auth/me"' "$(c "${R[@]}" "${H}/api/auth/me")"

echo; echo "== webhook oficial do WhatsApp (unica rota de integracao publica) - assinatura preservada ponta a ponta"
BODY1K="$(head -c 1024 /dev/zero | tr '\0' 'a')"
sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$WA_SECRET" | awk '{print "sha256="$NF}'; }
SIG="$(sign "$BODY1K")"
W="$(c "${R[@]}" -X POST -H "X-Hub-Signature-256: ${SIG}" -H 'X-Forwarded-For: 6.6.6.6' --data-binary "$BODY1K" "${H}/api/webhooks/whatsapp")"
check "POST assinado chega a /webhooks/whatsapp do backend" '"method":"POST","url":"/webhooks/whatsapp"' "$W"
check "o corpo chega INTACTO: a assinatura HMAC do corpo bruto confere no backend" '"sigOk":true' "$W"
check "corpo de 1024 bytes sem alteracao"   '"bytes":1024' "$W"
check "X-Forwarded-Proto = https"           '"proto":"https"' "$W"
refute "X-Forwarded-For forjado pelo cliente NAO chega" "6[.]6[.]6[.]6" "$W"
check "assinatura de OUTRO corpo -> 403 (corpo adulterado)" "403" "$(c "${R[@]}" -X POST -H "X-Hub-Signature-256: ${SIG}" --data-binary "${BODY1K}x" -o /dev/null -w '%{http_code}' "${H}/api/webhooks/whatsapp")"
check "sem cabecalho de assinatura -> 403"  "403" "$(c "${R[@]}" -X POST --data-binary "$BODY1K" -o /dev/null -w '%{http_code}' "${H}/api/webhooks/whatsapp")"
check "assinatura invalida -> 403"          "403" "$(c "${R[@]}" -X POST -H 'X-Hub-Signature-256: sha256=00' --data-binary "$BODY1K" -o /dev/null -w '%{http_code}' "${H}/api/webhooks/whatsapp")"
check "verificacao GET com o token certo devolve 200" "200" "$(c "${R[@]}" -o /dev/null -w '%{http_code}' "${H}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA_VERIFY}&hub.challenge=123")"
check "verificacao GET com token errado -> 403" "403" "$(c "${R[@]}" -o /dev/null -w '%{http_code}' "${H}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123")"
check "corpo acima de 256 KB -> 413"       "413" "$(head -c 300000 /dev/zero | tr '\0' 'a' | c "${R[@]}" -X POST --data-binary @- -o /dev/null -w '%{http_code}' "${H}/api/webhooks/whatsapp")"
LOGS="$(docker logs "${P}-https" 2>&1)"
refute "token de verificacao NAO aparece no log de acesso" "${WA_VERIFY}" "$LOGS"
refute "query string nao vai ao log" "hub[.]verify_token" "$LOGS"

echo; echo "== scripts/https-verify.sh contra esta pilha (como sera rodado na VPS, so que com certificado autoassinado)"
VERIFY_OUT="$(docker run --rm --network "$NET" -v "$PWD/scripts:/r/scripts:ro" alpine:3.20 sh -c "apk add -q --no-cache bash curl openssl >/dev/null && cd /r && SERVER_NAME=${DOMAIN} VERIFY_INSECURE=1 VERIFY_RESOLVE_IP=${HTTPS_IP} bash scripts/https-verify.sh" 2>&1)"
VERIFY_RC=$?
echo "$VERIFY_OUT" | sed 's/^/     | /'
if [ "$VERIFY_RC" -eq 0 ]; then ok "https-verify.sh passou"; else bad "https-verify.sh falhou" "rc=${VERIFY_RC}"; fi
check "https-verify imprime a URL do webhook em HTTPS" "https://${DOMAIN}/api/webhooks/whatsapp" "$VERIFY_OUT"

echo; echo "== modo HTTP local continua igual (a refatoracao nao quebrou nada)"
HH="$(c -D - -o /dev/null "http://${HTTP_IP}/")"
check "HTTP local serve a SPA"              "200" "$(c -o /dev/null -w '%{http_code}' "http://${HTTP_IP}/")"
refute "HSTS NAO e enviado em HTTP"         "strict-transport-security" "$HH"
check "CSP presente tambem em HTTP"         "content-security-policy" "$HH"
check "/api/service* -> 404 em HTTP"        "404" "$(c -o /dev/null -w '%{http_code}' "http://${HTTP_IP}/api/service/x")"
check "webhook roteado em HTTP (e SEM assinatura recusado pelo backend)" "403" "$(c -X POST --data x -o /dev/null -w '%{http_code}' "http://${HTTP_IP}/api/webhooks/whatsapp")"

echo; echo "== sem portas publicadas no host"
PORTS="$(docker port "${P}-https" 2>&1; docker port "${P}-http" 2>&1; docker port "${P}-backend" 2>&1)"
if [ -z "$PORTS" ]; then ok "containers de teste nao publicam porta"; else bad "containers de teste nao publicam porta" "$PORTS"; fi

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ]
