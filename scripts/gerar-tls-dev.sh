#!/usr/bin/env bash
# ===========================================================================
# Gera CA e certificado de servidor para o MySQL do ambiente LOCAL.
# ---------------------------------------------------------------------------
# ATENCAO: material de DESENVOLVIMENTO. Nao use nada daqui em producao.
#
# O que sai daqui NAO vai para o Git: `infra/tls/` esta no .gitignore, e os
# padroes *.pem / *.key tambem cobrem.
#
# Em producao, a CA e assinada FORA do servidor e so o necessario e copiado
# para la - em particular, a chave da CA nunca fica na VPS. Ver
# docs/adr/0003-topologia-de-producao.md.
# ---------------------------------------------------------------------------
#
# SEPARACAO DE MATERIAL - o ponto que mais importa aqui:
#
#   infra/tls/mysql/     ca.pem, server-cert.pem, server-key.pem
#                        montado SO no container do MySQL
#   infra/tls/backend/   ca.pem (somente a CA)
#                        montado SO no container do backend
#   infra/tls/ca-private/  ca-key.pem
#                        NAO montado em container nenhum
#
# O backend precisa validar quem e o servidor, e para isso basta a CA. Ele
# nunca recebe a chave privada do servidor nem a da CA.
# ===========================================================================
set -euo pipefail

# No Git Bash (Windows), argumentos que parecem caminho POSIX sao convertidos
# para caminho Windows. Isso DESTRUIRIA o `-subj "/C=BR/..."`, mas e NECESSARIO
# para os `-out`, porque o openssl aqui e um binario Windows. A exclusao e
# portanto dirigida: so os argumentos que comecam com `/C=`. Em Linux a
# variavel e ignorada e nada disso se aplica.
export MSYS2_ARG_CONV_EXCL='/C='

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TLS="$RAIZ/infra/tls"

# Hostname que o backend usa para conectar. TEM de ser igual a DATABASE_HOST do
# compose: o driver confere o SAN do certificado contra esse nome, e um nome
# diferente faz a conexao ser recusada (comprovado - ver
# docs/containerizacao.md).
HOST_MYSQL="${1:-mysql}"

if [ -d "$TLS" ]; then
  echo "ERRO: $TLS ja existe. Apague antes de gerar de novo:" >&2
  echo "  rm -rf \"$TLS\"" >&2
  exit 1
fi

mkdir -p "$TLS/mysql" "$TLS/backend" "$TLS/ca-private"

echo "--- CA local ---"
openssl genrsa -out "$TLS/ca-private/ca-key.pem" 4096
openssl req -new -x509 -nodes -days 3650 \
  -key "$TLS/ca-private/ca-key.pem" \
  -out "$TLS/mysql/ca.pem" \
  -subj "/C=BR/O=VastaFlow/OU=Desenvolvimento/CN=VastaFlow Local CA"

echo "--- certificado do servidor MySQL (SAN: $HOST_MYSQL) ---"
openssl genrsa -out "$TLS/mysql/server-key.pem" 2048
openssl req -new \
  -key "$TLS/mysql/server-key.pem" \
  -out "$TLS/server.csr" \
  -subj "/C=BR/O=VastaFlow/OU=Desenvolvimento/CN=$HOST_MYSQL"

# Varios nomes no SAN para que renomear o servico no compose nao obrigue a
# reemitir o certificado.
cat > "$TLS/server-ext.cnf" <<EXT
subjectAltName = DNS:$HOST_MYSQL, DNS:vastaflow-mysql, DNS:mysql.vastaflow.internal
extendedKeyUsage = serverAuth
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
EXT

openssl x509 -req -in "$TLS/server.csr" -days 825 \
  -CA "$TLS/mysql/ca.pem" \
  -CAkey "$TLS/ca-private/ca-key.pem" \
  -CAcreateserial \
  -extfile "$TLS/server-ext.cnf" \
  -out "$TLS/mysql/server-cert.pem"

echo "--- somente a CA vai para o backend ---"
cp "$TLS/mysql/ca.pem" "$TLS/backend/ca.pem"

# O `-CAcreateserial` grava o numero de serie ao lado do arquivo da CA, ou seja
# em mysql/ca.srl - nao na raiz de infra/tls. Sem este caminho, o arquivo
# sobraria e seria montado no container do MySQL sem necessidade.
rm -f "$TLS/server.csr" "$TLS/server-ext.cnf" "$TLS/mysql/ca.srl" "$TLS"/*.srl

# A chave do servidor precisa ser legivel pelo usuario do container do MySQL
# (uid 999 na imagem oficial) e por mais ninguem. Em Windows o chmod e
# aproximado; na VPS Linux ele vale.
chmod 600 "$TLS/ca-private/ca-key.pem" "$TLS/mysql/server-key.pem"
chmod 644 "$TLS/mysql/ca.pem" "$TLS/mysql/server-cert.pem" "$TLS/backend/ca.pem"

echo
echo "=== certificado gerado ==="
openssl x509 -in "$TLS/mysql/server-cert.pem" -noout -subject -ext subjectAltName -dates
echo
echo "=== cadeia confere? ==="
openssl verify -CAfile "$TLS/mysql/ca.pem" "$TLS/mysql/server-cert.pem"
echo
echo "=== o que cada container recebe ==="
echo "  mysql   (ro): $(ls "$TLS/mysql" | tr '\n' ' ')"
echo "  backend (ro): $(ls "$TLS/backend" | tr '\n' ' ')"
echo "  nenhum      : $(ls "$TLS/ca-private" | tr '\n' ' ')  <- chave da CA, fora dos containers"
echo
echo "ATENCAO: material de desenvolvimento. Validade do servidor: 825 dias."
echo "Certificado expirado = indisponibilidade total, porque a verificacao e obrigatoria."
