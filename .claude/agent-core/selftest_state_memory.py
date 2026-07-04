"""
selftest_state_memory.py — Valida state-memory/1.0 em diretório temporário.
Invariantes: índice vazio, upsert create/update in-place, read em camadas,
delete de chave e namespace, teto de valor, store corrompido, envelope sempre JSON.
"""

from __future__ import annotations

import json
import pathlib
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from state_memory_tool import manage_state_memory  # noqa: E402

tmp = pathlib.Path(tempfile.mkdtemp(prefix="state-memory-test-"))
STORE = str(tmp / "memory" / "state.json")


def call(**kwargs) -> dict:
    env = json.loads(manage_state_memory(store_path=STORE, **kwargs))
    assert env["protocol"] == "tool-contract/1.0", env
    return env


def expect(label: str, env: dict, **expected):
    for k, v in expected.items():
        got = env
        for part in k.split("__"):
            got = got[part]
        assert got == v, f"{label}: {k}={got!r}, esperado {v!r}\n{env}"
    print(f"[ok] {label}")


# 1. índice em store inexistente: vazio, sem erro
expect("index de store inexistente", call(action="index"),
       status="ok", data__size_bytes=0, data__namespaces={})

# 2. read de estado ausente: data_is_empty explícito
expect("read de namespace ausente", call(action="read", namespace="etl_vendas"),
       status="ok", data_is_empty=True)

# 3. upsert cria
expect("upsert cria chave", call(action="upsert", namespace="etl_vendas", key="checkpoint",
                                 value={"pagina": 12, "cursor": "abc"}, note="checkpoint da paginacao"),
       status="ok", data__outcome="created")

# 4. upsert na MESMA chave sobrescreve (in-place, sem versão nova)
expect("upsert sobrescreve in-place", call(action="upsert", namespace="etl_vendas", key="checkpoint",
                                           value={"pagina": 47, "cursor": "xyz"}),
       status="ok", data__outcome="updated")
env = call(action="read", namespace="etl_vendas", key="checkpoint")
expect("read devolve valor atual, nao historico", env, data__value__pagina=47)

# 5. índice mostra esqueleto sem valores
call(action="upsert", namespace="regras_negocio", key="frete_gratis",
     value="pedido acima R$199 + CEP sul/sudeste", note="confirmado com usuario")
env = call(action="index")
assert "regras_negocio" in env["data"]["namespaces"], env
assert "frete_gratis" in env["data"]["namespaces"]["regras_negocio"], env
assert "R$199" not in json.dumps(env["data"]["namespaces"]), "indice vazou valor"
print("[ok] index e esqueleto: chaves e notas, sem valores")

# 6. teto de valor: rejeita dump gigante com remediacao
env = call(action="upsert", namespace="etl_vendas", key="dump", value="x" * 5000)
expect("valor acima do teto rejeitado", env,
       status="error", category="invalid_input", agent_may_retry=True)

# 7. delete de premissa errada
expect("delete de chave", call(action="delete", namespace="regras_negocio", key="frete_gratis"),
       status="ok", data__deleted=True)
expect("delete idempotente (2a vez)", call(action="delete", namespace="regras_negocio", key="frete_gratis"),
       status="ok", data__deleted=False)

# 8. delete de namespace inteiro
expect("delete de namespace", call(action="delete", namespace="etl_vendas"),
       status="ok", data__deleted=True)

# 9. store corrompido: erro classificado, com .bak como remediacao
pathlib.Path(STORE).write_text("{quebrado", encoding="utf-8")
env = call(action="index")
expect("store corrompido vira STATE_CORRUPTED", env,
       status="error", error_code="STATE_CORRUPTED")
assert pathlib.Path(STORE + ".bak").exists(), "backup .bak ausente"
print("[ok] backup .bak presente para restauracao")

# 10. action invalida
expect("action desconhecida", call(action="append"),
       status="error", category="invalid_input")

print("SELFTEST STATE-MEMORY OK")
