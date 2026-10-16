#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - teste LOCAL de scripts/duckdns-update.sh contra um servidor FALSO em 127.0.0.1.
# Nao fala com o DuckDNS, nao usa conta nem token reais (o token aqui e sintetico e aleatorio).
#   bash infra/duckdns/test-duckdns.sh      (exit 0 = tudo passou)
# ===========================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1"; }

TOKEN="$(openssl rand -hex 16 | sed 's/\(........\)\(....\)\(....\)\(....\)\(............\)/\1-\2-\3-\4-\5/')"
PORT=$((20000 + RANDOM % 20000))
MODE_FILE="$TMP/modo"; echo OK > "$MODE_FILE"

cat > "$TMP/server.mjs" <<'JS'
import http from 'node:http';
import fs from 'node:fs';
const [port, log, modeFile] = process.argv.slice(2);
http.createServer((q, r) => {
  fs.appendFileSync(log, JSON.stringify({ method: q.method, url: q.url }) + '\n');
  const mode = fs.readFileSync(modeFile, 'utf8').trim();
  if (mode === 'REDIRECT') { r.writeHead(302, { location: 'http://127.0.0.1:1/x' }); r.end(); return; }
  r.end(mode);
}).listen(Number(port), '127.0.0.1');
JS
node "$TMP/server.mjs" "$PORT" "$TMP/requests.log" "$MODE_FILE" &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:${PORT}/" && break; sleep 0.2; done

run() { # run <env...> -> imprime saida; devolve codigo
  env DUCKDNS_ENV_FILE="$TMP/nao-existe.env" DUCKDNS_API_URL="http://127.0.0.1:${PORT}/update" DUCKDNS_TEST_INSECURE=1 \
      DUCKDNS_DOMAIN=vastaflow DUCKDNS_TOKEN="$TOKEN" "$@" bash scripts/duckdns-update.sh 2>&1
}

echo "== atualizacao"
OUT="$(run)"; RC=$?
[ "$RC" -eq 0 ] && ok "resposta OK -> exit 0" || bad "exit $RC"
grep -q "DuckDNS: OK" <<<"$OUT" && ok "mensagem de sucesso" || bad "mensagem: $OUT"
grep -q -- "$TOKEN" <<<"$OUT" && bad "TOKEN apareceu na saida" || ok "token NAO aparece na saida"
LINE="$(tail -n1 "$TMP/requests.log")"
grep -q '"method":"GET"' <<<"$LINE" && grep -q 'domains=vastaflow' <<<"$LINE" && grep -q "token=${TOKEN}" <<<"$LINE" \
  && ok "o servidor recebeu domains e token (so no corpo da requisicao)" || bad "requisicao inesperada: ${LINE:0:80}"

echo "== falhas"
echo KO > "$MODE_FILE"
OUT="$(run)"; RC=$?
[ "$RC" -eq 1 ] && ok "resposta KO -> exit 1" || bad "KO deu exit $RC"
grep -q -- "$TOKEN" <<<"$OUT" && bad "TOKEN apareceu na saida de erro" || ok "token NAO aparece na saida de erro"
echo REDIRECT > "$MODE_FILE"
run >/dev/null; RC=$?
[ "$RC" -eq 1 ] && ok "redirecionamento NAO e seguido (exit 1)" || bad "redirecionamento deu exit $RC"
echo OK > "$MODE_FILE"

echo "== validacao de entrada (nada chega a rede)"
BEFORE="$(wc -l < "$TMP/requests.log")"
run DUCKDNS_DOMAIN="vasta.duckdns.org" >/dev/null && bad "subdominio com .duckdns.org aceito" || ok "subdominio com .duckdns.org recusado"
run DUCKDNS_DOMAIN="a&token=x" >/dev/null && bad "subdominio com injecao aceito" || ok "subdominio com injecao de parametro recusado"
run DUCKDNS_TOKEN="curto" >/dev/null && bad "token curto aceito" || ok "token em formato inesperado recusado"
run DUCKDNS_TOKEN="${TOKEN}&domains=outro" >/dev/null && bad "token com injecao aceito" || ok "token com injecao recusado"
run DUCKDNS_IP="999.1.1" >/dev/null && bad "IP invalido aceito" || ok "IP invalido recusado"
run DUCKDNS_TEST_INSECURE=0 >/dev/null && bad "URL http aceita sem o modo de teste" || ok "URL http recusada fora do modo de teste"
AFTER="$(wc -l < "$TMP/requests.log")"
[ "$BEFORE" = "$AFTER" ] && ok "nenhuma requisicao foi feita nos casos recusados" || bad "houve requisicao em caso invalido"
OUT="$(run DUCKDNS_TOKEN="curto-demais" 2>&1)"; grep -q "curto-demais" <<<"$OUT" && bad "valor invalido ecoado" || ok "valor invalido nao e repetido na mensagem"

echo "== o token nao vai em argumento de comando"
if grep -nE 'curl[^|]*(token=|DUCKDNS_TOKEN)' scripts/duckdns-update.sh | grep -v '^#'; then bad "curl recebe o token no argv"; else ok "curl nao recebe o token no argv (usa -K -)"; fi
grep -q 'curl .*-K -' scripts/duckdns-update.sh && ok "curl le a URL por stdin (-K -)" || bad "-K - ausente"

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ]
