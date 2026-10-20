#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - TESTE DE REGRESSAO do PRIMEIRO BOOT HTTPS, com o Compose REAL.
# ---------------------------------------------------------------------------
# Por que existe: o bug "nginx unhealthy / Let's Encrypt falha" so aparece quando o contêiner sobe pelo
# `command` de docker-compose.https.yml. Os outros testes (test-https.sh, test-acme.sh) montam o nginx a mao e
# chamam o entrypoint com `nginx` como primeiro argumento, entao NAO viam o defeito. Este teste sobe o servico
# `nginx` pelos arquivos de Compose de verdade e confere o que a VPS precisa:
#   - o entrypoint gerou /etc/nginx/conf.d/10-https.conf a partir do modelo (com o dominio);
#   - o healthcheck do Compose fica "healthy" (a :80 responde);
#   - a :80 so redireciona/atende ACME, a :443 responde com HSTS (certificado temporario, como o https-init.sh);
#   - o laco de recarga (renovacao) continua rodando e `nginx -s reload` funciona;
#   - nenhuma porta e publicada no host por este teste;
#   - CONTROLE NEGATIVO: o comando antigo (sem passar pelo entrypoint com `nginx`) NAO gera a configuracao,
#     provando que este teste teria pego o defeito.
# Isolado: projeto Compose `vf-boot-test`, volumes proprios, so o servico nginx, valores sinteticos.
#   bash infra/https/test-compose-boot.sh        (exit 0 = tudo passou)
# ===========================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."

P="vf-boot-test"
DOMAIN="vastaflow.duckdns.org"
IMAGE="vf-boot-test-nginx:latest"
COMPOSE=(docker compose -p "$P" --env-file infra/https/test-boot.env
         -f docker-compose.production.yml -f docker-compose.https.yml -f infra/https/test-compose-boot.override.yml)
PASS=0; FAIL=0

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "${P}-controle" >/dev/null 2>&1 || true
  docker volume rm vf-boot-test-letsencrypt vf-boot-test-webroot "${P}-ctl-certs" >/dev/null 2>&1 || true
  [ "${KEEP_IMAGE:-0}" = "1" ] || docker rmi "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1  [$2]"; }
check()  { if printf '%s' "$3" | grep -qiE -- "$2"; then ok "$1"; else bad "$1" "esperado /$2/, obtido: $(printf '%s' "$3" | head -c 200 | tr '\n' ' ')"; fi; }
refute() { if printf '%s' "$3" | grep -qiE -- "$2"; then bad "$1" "apareceu /$2/"; else ok "$1"; fi; }

echo "Preparando (imagem REAL do nginx, a do Dockerfile do frontend)..."
docker build -q -t "$IMAGE" --build-arg VITE_API_URL=/api frontend >/dev/null || { echo "ERRO: build da imagem falhou" >&2; exit 2; }
docker pull -q alpine:3.20 >/dev/null; docker pull -q curlimages/curl:8.10.1 >/dev/null

# Certificado TEMPORARIO exatamente como scripts/https-init.sh o cria (o nginx nao sobe sem um certificado).
mkcert() { # mkcert <volume>
  docker run --rm -v "$1:/etc/letsencrypt" alpine:3.20 sh -c "
    apk add --no-cache openssl >/dev/null &&
    mkdir -p /etc/letsencrypt/live/${DOMAIN} &&
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=${DOMAIN}' \
      -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem 2>/dev/null &&
    touch /etc/letsencrypt/live/${DOMAIN}/.vastaflow-temporario"
}
docker volume create vf-boot-test-letsencrypt >/dev/null; docker volume create vf-boot-test-webroot >/dev/null
mkcert vf-boot-test-letsencrypt
docker run --rm -v vf-boot-test-webroot:/w alpine:3.20 sh -c 'mkdir -p /w/.well-known/acme-challenge && echo acme-ok > /w/.well-known/acme-challenge/probe'

echo; echo "== sobe SO o servico nginx pelos arquivos de Compose reais"
"${COMPOSE[@]}" up -d --no-deps nginx >/dev/null 2>&1 || { echo "ERRO: compose up falhou" >&2; "${COMPOSE[@]}" logs nginx | tail -20; exit 2; }
CID="$("${COMPOSE[@]}" ps -q nginx)"
status=""
for _ in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null)"
  [ "$status" = "healthy" ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$CID")" = "true" ] || break
  sleep 3
done
check "o healthcheck do Compose fica 'healthy' (a :80 responde)" "^healthy$" "$status"
if [ "$status" != "healthy" ]; then echo "---- logs do nginx (diagnostico) ----"; docker logs "$CID" 2>&1 | tail -15; fi

echo; echo "== a configuracao foi gerada pelo entrypoint"
check "o entrypoint LANCOU o envsubst (log do contêiner)" "20-envsubst-on-templates.sh" "$(docker logs "$CID" 2>&1)"
check "/etc/nginx/conf.d/10-https.conf EXISTE" "10-https.conf" "$(docker exec "$CID" ls /etc/nginx/conf.d)"
RENDERED="$(docker exec "$CID" cat /etc/nginx/conf.d/10-https.conf 2>&1)"
check "o arquivo gerado traz o dominio do SERVER_NAME" "server_name ${DOMAIN};" "$RENDERED"
check "e o caminho do certificado desse dominio" "live/${DOMAIN}/fullchain.pem" "$RENDERED"
refute "nenhum marcador de modelo sobrou" '[$][{]SERVER_NAME[}]' "$RENDERED"
check "nginx -t valida a configuracao final" "successful" "$(docker exec "$CID" nginx -t 2>&1)"
check "o servidor HTTP completo da imagem foi anulado (so comentarios)" "^#" "$(docker exec "$CID" cat /etc/nginx/conf.d/vastaflow.conf)"

echo; echo "== comportamento de rede (cliente na mesma rede, nada publicado no host)"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID")"
IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CID")"
c() { docker run --rm --network "$NET" curlimages/curl:8.10.1 -s --max-time 10 "$@"; }
check ":80 /nginx-health responde ok"        "ok" "$(c -H "Host: ${DOMAIN}" "http://${IP}/nginx-health")"
check ":80 redireciona para HTTPS (301)"     "301 https://${DOMAIN}/" "$(c -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: ${DOMAIN}" "http://${IP}/")"
check ":80 atende o desafio ACME (webroot)"  "acme-ok" "$(c -H "Host: ${DOMAIN}" "http://${IP}/.well-known/acme-challenge/probe")"
# A pagina inicial (SPA) passa pelo bloco de seguranca; /nginx-health e interno e proposital sem cabecalhos.
HDR="$(c -k --resolve "${DOMAIN}:443:${IP}" -D - -o /dev/null "https://${DOMAIN}/")"
check ":443 responde (HTTP/2 ou 1.1 200)"    "HTTP/[12](\.1)? 200" "$HDR"
check ":443 envia HSTS"                      "strict-transport-security" "$HDR"
check ":443 envia CSP"                       "content-security-policy" "$HDR"
check "/api/service* segue bloqueado (404)"  "404" "$(c -k --resolve "${DOMAIN}:443:${IP}" -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/service/x")"
PORTS="$(docker port "$CID" 2>&1)"
if [ -z "$PORTS" ]; then ok "o teste NAO publica porta no host"; else bad "o teste publicou porta no host" "$PORTS"; fi

echo; echo "== renovacao: o laco de recarga esta ativo e o reload funciona"
check "o laco 'sleep 6h; nginx -s reload' esta rodando" "sleep 6h" "$(docker exec "$CID" ps 2>&1)"
if docker exec "$CID" nginx -s reload >/dev/null 2>&1; then ok "nginx -s reload funciona (recarrega o certificado renovado sem derrubar)"; else bad "nginx -s reload falhou" "-"; fi
sleep 2
check "apos o reload continua healthy" "^healthy$|^starting$" "$(docker inspect -f '{{.State.Health.Status}}' "$CID")"
check "PID 1 e o nginx (sinais/parada limpa)" "nginx: master process" "$(docker exec "$CID" sh -c 'cat /proc/1/cmdline | tr "\0" " "')"

echo; echo "== definicao do Compose"
CMD="$(docker inspect -f '{{json .Config.Cmd}}' "$CID")"
check "o command chama o entrypoint COM 'nginx' como primeiro argumento" '/docker-entrypoint.sh nginx -g' "$CMD"
check "ainda exec (nginx vira o processo principal)" 'exec /docker-entrypoint.sh' "$CMD"

echo; echo "== CONTROLE NEGATIVO: o comando ANTIGO nao gera a configuracao (prova que o teste pega o defeito)"
docker volume create "${P}-ctl-certs" >/dev/null; mkcert "${P}-ctl-certs"
docker run -d --name "${P}-controle" \
  -e "SERVER_NAME=${DOMAIN}" -e 'NGINX_ENVSUBST_FILTER=^SERVER_NAME$' -e NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d \
  -v "$PWD/infra/https/vastaflow-https.conf.template:/etc/nginx/templates/10-https.conf.template:ro" \
  -v "$PWD/infra/https/vastaflow-http-disabled.conf:/etc/nginx/conf.d/vastaflow.conf:ro" \
  -v "${P}-ctl-certs:/etc/letsencrypt:ro" \
  "$IMAGE" /bin/sh -c 'while :; do sleep 6h; nginx -s reload; done & exec nginx -g "daemon off;"' >/dev/null
sleep 4
if docker exec "${P}-controle" test -f /etc/nginx/conf.d/10-https.conf 2>/dev/null; then bad "controle: o comando antigo gerou a configuracao (o defeito nao reproduz)" "-"; else ok "controle: com o comando antigo o 10-https.conf NAO e gerado (defeito reproduzido)"; fi
refute "controle: o entrypoint nao rodou o envsubst" "20-envsubst-on-templates.sh" "$(docker logs "${P}-controle" 2>&1)"
check "controle: nada escuta na :80 (healthcheck falharia)" "refused|failed|error|^$" "$(docker exec "${P}-controle" wget -q -O - http://127.0.0.1/nginx-health 2>&1)"

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ]
