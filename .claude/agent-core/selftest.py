"""
selftest.py — Valida o tool-contract/1.0 sem rede: sucesso com retry automático,
não-idempotente sem auto-retry, invalid_input, resultado vazio e exceção crua.
Sai com código 0 e imprime SELFTEST OK se todos os invariantes segurarem.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from tool_contract import (  # noqa: E402
    InvalidInputError,
    RetryPolicy,
    tool_contract,
)

FAST = RetryPolicy(max_attempts=3, base_delay_s=0.01, max_delay_s=0.02, jitter_s=0.0)

calls = {"flaky": 0, "writer": 0}


@tool_contract(name="flaky_read", idempotent=True, retry=FAST)
def flaky_read():
    """Falha 2x com erro transitório, sucede na 3a — auto-retry deve resolver."""
    calls["flaky"] += 1
    if calls["flaky"] < 3:
        raise ConnectionError("conexao resetada pelo peer")
    return {"rows": [1, 2, 3]}


@tool_contract(name="risky_write", idempotent=False, retry=FAST)
def risky_write():
    """Nao-idempotente: erro transitório NAO pode ser retentado automaticamente."""
    calls["writer"] += 1
    raise TimeoutError("upstream lento durante o POST")


@tool_contract(name="typed_input", idempotent=True)
def typed_input(date: str):
    raise InvalidInputError(
        f"'date' deve ser ISO-8601, recebi {date!r}",
        remediation="Reenvie 'date' no formato YYYY-MM-DD.",
    )


@tool_contract(name="empty_read", idempotent=True)
def empty_read():
    return {"rows": []}


@tool_contract(name="buggy_tool", idempotent=True, retry=FAST)
def buggy_tool():
    raise KeyError("coluna_inexistente")  # exceção crua — deve virar UNEXPECTED_EXCEPTION


def check(label: str, envelope_str: str, **expected) -> dict:
    env = json.loads(envelope_str)  # invariante 0: sempre JSON parseável
    assert env["protocol"] == "tool-contract/1.0", env
    for key, value in expected.items():
        assert env[key] == value, f"{label}: {key}={env[key]!r}, esperado {value!r}\n{env}"
    print(f"[ok] {label}: " + json.dumps(env, ensure_ascii=False)[:160])
    return env


check("retry automatico resolve transitorio", flaky_read(),
      status="ok", attempts=3, data_is_empty=False)
assert calls["flaky"] == 3

check("nao-idempotente nao sofre auto-retry", risky_write(),
      status="error", category="timeout", error_code="UPSTREAM_TIMEOUT", attempts=1,
      side_effects_possible=True, auto_retry_suppressed=True, agent_may_retry=False)
assert calls["writer"] == 1, "auto-retry indevido em ferramenta com efeito colateral"

check("invalid_input orienta correcao pelo agente", typed_input("ontem"),
      status="error", category="invalid_input", agent_may_retry=True,
      side_effects_possible=False)

check("vazio e explicito, nao ausencia", empty_read(),
      status="ok", data_is_empty=True)

check("excecao crua vira envelope classificado", buggy_tool(),
      status="error", error_code="UNEXPECTED_EXCEPTION", category="permanent",
      agent_may_retry=False)

print("SELFTEST OK")
