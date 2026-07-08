#!/usr/bin/env bash
# Suite SQL local: Postgres efêmero em Docker + shim Supabase + migrações
# na ordem + verificacao_nucleo.sql. Verde = "OK: N/N asserts" no notice.
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

# raise notice sai no stderr do psql — capturar junto.
for teste in verificacao_nucleo verificacao_assistente; do
  echo "== asserts: supabase/tests/$teste.sql"
  saida=$(docker exec -i "$CONTAINER" psql -U postgres -d app -v ON_ERROR_STOP=1 \
    <"supabase/tests/$teste.sql" 2>&1) || { echo "$saida"; echo "SQL SUITE VERMELHA ($teste)"; exit 1; }
  echo "$saida"
  echo "$saida" | grep -q "OK: .* asserts" || {
    echo "SQL SUITE VERMELHA (notice de sucesso ausente em $teste)"; exit 1; }
done
echo "SQL SUITE VERDE"
