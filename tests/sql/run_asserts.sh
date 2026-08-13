#!/usr/bin/env bash
# Runner unico dos asserts de supabase/tests, compartilhado por run_local.sh e
# pelo CI. Nao existe lista de arquivos aqui: o glob E a lista. Arquivo novo em
# supabase/tests passa a rodar sozinho, sem ninguem lembrar de cadastrar.
#
# Motivo: a lista estava escrita a mao em DOIS lugares (run_local.sh e ci.yml).
# Divergiu em silencio e 4 dos 8 asserts nunca rodaram — inclusive os da
# conciliacao de fatura, que guardam contagem dupla de despesa.
#
# O chamador exporta PSQL_CMD com o psql ja apontado para o banco certo.
# O arquivo .sql chega por stdin, que funciona nos dois contextos.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PSQL_CMD:?PSQL_CMD nao definido — quem chama precisa dizer como falar com o banco}"

shopt -s nullglob
arquivos=(supabase/tests/*.sql)

# Zero arquivo e sintoma de path errado ou glob quebrado, nao de suite vazia.
if [ "${#arquivos[@]}" -eq 0 ]; then
  echo "ERRO: nenhum assert encontrado em supabase/tests"
  exit 1
fi

for f in "${arquivos[@]}"; do
  echo "== asserts: $f"
  # raise notice sai no stderr do psql — capturar junto.
  saida=$($PSQL_CMD <"$f" 2>&1) || {
    echo "$saida"
    echo "SQL SUITE VERMELHA ($f)"
    exit 1
  }
  echo "$saida"
  echo "$saida" | grep -q "OK: .* asserts" || {
    echo "SQL SUITE VERMELHA (notice de sucesso ausente em $f)"
    exit 1
  }
done

echo "asserts executados: ${#arquivos[@]}/${#arquivos[@]}"
