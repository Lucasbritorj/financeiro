#!/usr/bin/env bash
# Suite SQL local: Postgres efêmero em Docker + shim Supabase + migrações
# na ordem + asserts (núcleo, assistente, isolamento cross-tenant).
# Verde = "OK: N/N asserts" no notice de cada arquivo.
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER=financeiro-web-pgtest
IMAGEM=postgres:16-alpine

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=app "$IMAGEM" >/dev/null
# Teardown em QUALQUER saída (sucesso, falha de migração, falha de assert).
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

pronto=""
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d app >/dev/null 2>&1; then
    pronto=1; break
  fi
  sleep 1
done
[ -n "$pronto" ] || { echo "ERRO: Postgres não subiu em 30s"; exit 1; }

run_sql() {
  docker exec -i "$CONTAINER" psql -U postgres -d app -v ON_ERROR_STOP=1 -q <"$1"
}

echo "== shim: tests/sql/00_shim_auth.sql"
run_sql tests/sql/00_shim_auth.sql

for f in supabase/migrations/*.sql; do
  echo "== migração: $f"
  run_sql "$f"
done

# Asserts: lista unica em tests/sql/run_asserts.sh, derivada do glob.
PSQL_CMD="docker exec -i $CONTAINER psql -U postgres -d app -v ON_ERROR_STOP=1" \
  bash tests/sql/run_asserts.sh

echo "SQL SUITE VERDE"
