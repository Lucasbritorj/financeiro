"""
state_memory_tool.py — Máquina de Memória de Estado (state-memory/1.0)

Estado persistente entre sessões para fluxos longos (ETL contínuo, mapeamento de
regras de negócio). Um arquivo JSON local, atualização IN-PLACE por chave:
upsert sobrescreve, delete remove — o arquivo não cresce por append infinito.

Decisões de arquitetura (pragmáticas):
  - JSON, não Markdown: estado de máquina precisa ser parseável e endereçável
    por chave. Prosa humana fica na skill mem-lite; checkpoint fica aqui.
  - Serialização determinística (sort_keys): mesmo estado gera mesmos bytes —
    amigável a cache de prompt e a diffs.
  - Leitura em camadas: "index" (esqueleto barato) antes de "read" (valor caro).
    Economia de tokens acontece na LEITURA, onde o custo é recorrente.
  - Escrita atômica (temp + os.replace) com backup .bak — crash não corrompe.
  - Teto de 4000 chars por valor: memória de estado não é dumping ground.

Integra tool-contract/1.0: toda chamada retorna o envelope padrão.
Somente stdlib. Single-writer (agente local); sem lock distribuído por decisão.
"""

from __future__ import annotations

import json
import pathlib
import re
import os
from datetime import datetime, timezone
from typing import Any

from tool_contract import InvalidInputError, ToolError, tool_contract

PROTOCOL = "state-memory/1.0"
DEFAULT_STORE = "memory/state.json"
MAX_VALUE_CHARS = 4000
HYGIENE_THRESHOLD_BYTES = 64_000
ACTIONS = ("index", "read", "upsert", "delete")
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.\-]{0,63}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _validate_name(kind: str, value: str) -> str:
    if not isinstance(value, str) or not _NAME_RE.match(value):
        raise InvalidInputError(
            f"{kind} inválido: {value!r}",
            remediation=f"Use {kind} minúsculo, [a-z0-9_.-], até 64 chars, ex: 'etl_vendas'.",
        )
    return value


def _load(path: pathlib.Path) -> dict:
    if not path.exists():
        return {"protocol": PROTOCOL, "updated_at": _now(), "namespaces": {}}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise ToolError(
            f"store corrompido ou ilegível: {path}",
            error_code="STATE_CORRUPTED",
            remediation=f"Restaure {path}.bak (última escrita boa) ou delete o arquivo para recomeçar.",
        ) from exc
    if doc.get("protocol") != PROTOCOL or not isinstance(doc.get("namespaces"), dict):
        raise ToolError(
            f"{path} não segue {PROTOCOL}",
            error_code="STATE_WRONG_PROTOCOL",
            remediation="Arquivo de outro sistema no caminho do store. Aponte store_path para outro arquivo.",
        )
    return doc


def _save(path: pathlib.Path, doc: dict) -> int:
    doc["updated_at"] = _now()
    payload = json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=1)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.with_suffix(path.suffix + ".bak").write_bytes(path.read_bytes())
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, path)
    return len(payload.encode("utf-8"))


def _entry_view(entry: dict) -> dict:
    return {"value": entry["v"], "note": entry.get("note"), "updated_at": entry["updated_at"]}


@tool_contract(name="manage_state_memory", idempotent=True)
def manage_state_memory(
    action: str,
    namespace: str | None = None,
    key: str | None = None,
    value: Any = None,
    note: str | None = None,
    store_path: str = DEFAULT_STORE,
) -> dict:
    """Lê, grava (in-place) e deleta estado persistente.

    Ações:
      index  — esqueleto do store: namespaces, chaves e notas. SEM valores. Barato.
      read   — namespace inteiro, ou uma chave se 'key' informada.
      upsert — cria/sobrescreve 'key' em 'namespace'. Mesma chave = substituição.
      delete — remove 'key'; sem 'key', remove o namespace inteiro.
    """
    if action not in ACTIONS:
        raise InvalidInputError(
            f"action desconhecida: {action!r}",
            remediation=f"Use uma de: {', '.join(ACTIONS)}.",
        )

    path = pathlib.Path(store_path)
    doc = _load(path)
    namespaces: dict = doc["namespaces"]

    if action == "index":
        return {
            "store": str(path),
            "size_bytes": path.stat().st_size if path.exists() else 0,
            "namespaces": {
                ns: {k: (e.get("note") or "") for k, e in entries.items()}
                for ns, entries in sorted(namespaces.items())
            },
        }

    if namespace is None:
        raise InvalidInputError(
            f"'namespace' obrigatório para action={action!r}",
            remediation="Informe o namespace da rotina, ex: 'etl_vendas'.",
        )
    _validate_name("namespace", namespace)
    if key is not None:
        _validate_name("key", key)

    if action == "read":
        entries = namespaces.get(namespace, {})
        if key is not None:
            entry = entries.get(key)
            if entry is None:
                return {}  # envelope marca data_is_empty: estado não existe
            return {"namespace": namespace, "key": key, **_entry_view(entry)}
        if not entries:
            return {}
        return {
            "namespace": namespace,
            "entries": {k: _entry_view(e) for k, e in sorted(entries.items())},
        }

    if action == "upsert":
        if key is None:
            raise InvalidInputError("'key' obrigatória no upsert",
                                    remediation="Uma chave por fato, ex: 'checkpoint'.")
        try:
            serialized = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            raise InvalidInputError(
                f"value não é JSON-serializável: {type(value).__name__}",
                remediation="Envie dict/list/str/num/bool/null.",
            ) from exc
        if value is None:
            raise InvalidInputError("value null proibido no upsert",
                                    remediation="Para remover estado use action='delete'.")
        if len(serialized) > MAX_VALUE_CHARS:
            raise InvalidInputError(
                f"value com {len(serialized)} chars excede teto de {MAX_VALUE_CHARS}",
                remediation="Resuma em estilo caveman ou divida em chaves menores. "
                            "Memória de estado guarda destilado, não dump.",
            )
        entries = namespaces.setdefault(namespace, {})
        outcome = "updated" if key in entries else "created"
        entries[key] = {"v": value, "updated_at": _now()}
        if note:
            entries[key]["note"] = str(note)[:200]
        size = _save(path, doc)
        result = {"namespace": namespace, "key": key, "outcome": outcome, "store_size_bytes": size}
        if size > HYGIENE_THRESHOLD_BYTES:
            result["hygiene"] = (
                f"store passou de {HYGIENE_THRESHOLD_BYTES} bytes: delete premissas mortas "
                "e comprima notas antes de continuar acumulando"
            )
        return result

    # action == "delete"
    entries = namespaces.get(namespace)
    if entries is None:
        return {"namespace": namespace, "key": key, "deleted": False, "reason": "namespace não existia"}
    if key is not None:
        existed = entries.pop(key, None) is not None
        if not entries:
            namespaces.pop(namespace)  # namespace vazio não fica apodrecendo no índice
        if existed:
            _save(path, doc)
        return {"namespace": namespace, "key": key, "deleted": existed,
                **({} if existed else {"reason": "key não existia"})}
    namespaces.pop(namespace)
    _save(path, doc)
    return {"namespace": namespace, "deleted": True, "scope": "namespace inteiro"}
