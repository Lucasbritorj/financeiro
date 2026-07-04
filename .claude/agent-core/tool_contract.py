"""
tool_contract.py — Protocolo de Contrato de Erro e Retentativa (tool-contract/1.0)

Fundação arquitetural do Antigravity: TODA ferramenta de ação do sistema deve ser
envolvida por @tool_contract. O wrapper garante que o LLM nunca receba stack trace
bruto nem silêncio — apenas um envelope JSON estável com semântica de retry.

Regras do contrato:
  1. Toda chamada retorna uma string JSON com "status": "ok" | "error".
  2. Erros transitórios são retentados AQUI (em código, com backoff exponencial e
     jitter) — nunca pelo LLM. O LLM só retenta quando pode mudar algo material
     (categoria "invalid_input", campo "agent_may_retry").
  3. Ferramentas não-idempotentes nunca são retentadas automaticamente; o envelope
     marca "side_effects_possible": true para o agente verificar estado antes de repetir.
  4. Stack traces completos vão para o log com um trace_id; o LLM recebe uma
     mensagem de uma linha + remediação acionável.

Somente stdlib. Compatível com Windows (sem signal/alarm).
"""

from __future__ import annotations

import functools
import json
import logging
import logging.handlers
import os
import pathlib
import random
import time
import traceback
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Sequence, Type

PROTOCOL = "tool-contract/1.0"

logger = logging.getLogger("tool_contract")


# --------------------------------------------------------------------------- #
# Taxonomia de erros — subclasses definem a política de retry
# --------------------------------------------------------------------------- #
class ToolError(Exception):
    """Erro classificado. Lance subclasses dentro das ferramentas; nunca deixe
    exceções cruas vazarem — o wrapper as classifica como UNEXPECTED_EXCEPTION."""

    category: str = "permanent"
    error_code: str = "PERMANENT_FAILURE"
    auto_retry: bool = False        # o wrapper pode retentar sozinho?
    agent_may_retry: bool = False   # o agente pode retentar mudando algo?

    def __init__(self, message: str, *, remediation: str | None = None,
                 error_code: str | None = None):
        super().__init__(message)
        self.remediation = remediation
        if error_code:
            self.error_code = error_code


class TransientError(ToolError):
    """Rede, 5xx, IO intermitente. Retentável automaticamente (se idempotente)."""
    category = "transient"
    error_code = "TRANSIENT_FAILURE"
    auto_retry = True


class UpstreamTimeout(TransientError):
    category = "timeout"
    error_code = "UPSTREAM_TIMEOUT"


class RateLimited(TransientError):
    error_code = "RATE_LIMITED"

    def __init__(self, message: str, *, retry_after_s: float | None = None, **kw):
        super().__init__(message, **kw)
        self.retry_after_s = retry_after_s


class InvalidInputError(ToolError):
    """Argumentos errados. O AGENTE deve corrigir os parâmetros e chamar de novo."""
    category = "invalid_input"
    error_code = "INVALID_INPUT"
    agent_may_retry = True


class AuthError(ToolError):
    """Credencial ausente/expirada/sem permissão. Nunca retentar; escalar."""
    category = "auth"
    error_code = "AUTH_FAILURE"


_DEFAULT_REMEDIATION = {
    "transient": "Retentativas automáticas esgotadas. Não repita com os mesmos argumentos; mude algo material ou reporte a falha.",
    "timeout": "O upstream não respondeu no prazo. Reduza o escopo da consulta (janela, página) ou reporte a falha.",
    "invalid_input": "Corrija os argumentos indicados e chame novamente (máx. 2 correções).",
    "auth": "Credencial ausente/expirada. Não retente; escale ao usuário.",
    "permanent": "Falha não recuperável. Não retente; reporte com o trace_id.",
}


# --------------------------------------------------------------------------- #
# Política de retry (executada em código — custo zero de tokens)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_s: float = 1.0
    backoff_factor: float = 2.0
    max_delay_s: float = 30.0
    jitter_s: float = 0.5


# --------------------------------------------------------------------------- #
# O decorator — a fundação
# --------------------------------------------------------------------------- #
def tool_contract(
    name: str | None = None,
    *,
    retry: RetryPolicy = RetryPolicy(),
    idempotent: bool = False,
    transient_exceptions: Sequence[Type[BaseException]] = (ConnectionError, TimeoutError),
    max_result_chars: int = 50_000,
) -> Callable:
    """Envolve uma ferramenta de ação no tool-contract/1.0.

    Args:
        name: nome lógico da ferramenta (default: nome da função).
        retry: política de retentativa automática para erros transitórios.
        idempotent: SÓ marque True se re-executar com os mesmos argumentos for
            comprovadamente seguro (GET puro, leitura, upsert com chave natural).
            Ferramentas não-idempotentes nunca sofrem auto-retry.
        transient_exceptions: exceções nativas tratadas como transitórias.
        max_result_chars: teto do payload serializado devolvido ao LLM.
    """

    def decorator(fn: Callable) -> Callable:
        tool_name = name or fn.__name__

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> str:
            trace_id = uuid.uuid4().hex[:12]
            attempt = 0
            while True:
                attempt += 1
                try:
                    data = fn(*args, **kwargs)
                    return _ok_envelope(tool_name, data, attempt, trace_id, max_result_chars)
                except Exception as exc:  # fronteira do sistema — classificação obrigatória
                    err = _classify(exc, tuple(transient_exceptions))
                    logger.error(
                        "tool=%s trace_id=%s attempt=%d/%d code=%s\n%s",
                        tool_name, trace_id, attempt, retry.max_attempts,
                        err.error_code, traceback.format_exc(),
                    )
                    if err.auto_retry and idempotent and attempt < retry.max_attempts:
                        time.sleep(_next_delay(err, attempt, retry))
                        continue
                    return _error_envelope(
                        tool_name, err, attempt, retry.max_attempts, trace_id, idempotent
                    )

        wrapper.__tool_contract__ = PROTOCOL
        return wrapper

    return decorator


# --------------------------------------------------------------------------- #
# Internos
# --------------------------------------------------------------------------- #
def _classify(exc: Exception, transient: tuple) -> ToolError:
    if isinstance(exc, ToolError):
        return exc
    if isinstance(exc, TimeoutError):
        return UpstreamTimeout(_first_line(exc))
    if isinstance(exc, transient):
        return TransientError(_first_line(exc))
    return ToolError(
        _first_line(exc),
        error_code="UNEXPECTED_EXCEPTION",
        remediation="Erro não classificado; inspecione o log pelo trace_id antes de qualquer retentativa.",
    )


def _next_delay(err: ToolError, attempt: int, retry: RetryPolicy) -> float:
    if isinstance(err, RateLimited) and err.retry_after_s:
        return min(err.retry_after_s, retry.max_delay_s)
    delay = min(retry.base_delay_s * (retry.backoff_factor ** (attempt - 1)), retry.max_delay_s)
    return delay + random.uniform(0.0, retry.jitter_s)


def _first_line(exc: BaseException) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return text.splitlines()[0][:500]


def _is_empty(data: Any) -> bool:
    if data is None:
        return True
    if isinstance(data, (str, bytes, list, tuple, dict)) and len(data) == 0:
        return True
    if isinstance(data, dict):
        rows = data.get("rows")
        if isinstance(rows, (list, tuple)) and len(rows) == 0:
            return True
    return False


def _ok_envelope(tool: str, data: Any, attempts: int, trace_id: str, max_chars: int) -> str:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    truncated = len(payload) > max_chars
    envelope: dict[str, Any] = {
        "protocol": PROTOCOL,
        "status": "ok",
        "tool": tool,
        "attempts": attempts,
        "trace_id": trace_id,
        "data_is_empty": _is_empty(data),
        "truncated": truncated,
    }
    if truncated:
        # Nunca devolver JSON quebrado: payload grande vira string-prévia + instrução.
        envelope["data"] = payload[:max_chars]
        envelope["truncation_note"] = (
            f"payload de {len(payload)} chars truncado para {max_chars}; "
            "refine a consulta (filtros/paginação) em vez de raciocinar sobre o fragmento"
        )
    else:
        envelope["data"] = json.loads(payload)
    return json.dumps(envelope, ensure_ascii=False)


def _error_envelope(tool: str, err: ToolError, attempts: int, max_attempts: int,
                    trace_id: str, idempotent: bool) -> str:
    # Auto-retry pode não ter ocorrido por dois motivos distintos — o agente
    # precisa saber qual: esgotado (não repita) vs suprimido (verifique estado).
    retries_exhausted = err.auto_retry and attempts >= max_attempts
    retry_suppressed = err.auto_retry and not idempotent and attempts < max_attempts
    remediation = err.remediation or (
        "Retentativa automática suprimida: a operação pode ter efeitos colaterais. "
        "Verifique o estado real com uma ferramenta de LEITURA antes de qualquer nova tentativa."
        if retry_suppressed
        else _DEFAULT_REMEDIATION[err.category]
    )
    return json.dumps(
        {
            "protocol": PROTOCOL,
            "status": "error",
            "tool": tool,
            "error_code": err.error_code,
            "category": err.category,
            "attempts": attempts,
            "max_attempts": max_attempts,
            "auto_retries_exhausted": retries_exhausted,
            "auto_retry_suppressed": retry_suppressed,
            "agent_may_retry": err.agent_may_retry,
            "side_effects_possible": not idempotent,
            "trace_id": trace_id,
            "message": _first_line(err),
            "remediation": remediation,
            "data": None,
        },
        ensure_ascii=False,
    )


# --------------------------------------------------------------------------- #
# Logging — chame uma vez no boot do host (servidor MCP, worker, etc.)
# --------------------------------------------------------------------------- #
def configure_logging(log_dir: str | os.PathLike | None = None,
                      level: int = logging.INFO) -> pathlib.Path:
    """Log rotativo com os stack traces completos, correlacionados por trace_id."""
    target = pathlib.Path(log_dir) if log_dir else pathlib.Path.home() / ".antigravity-core" / "logs"
    target.mkdir(parents=True, exist_ok=True)
    logfile = target / "tool_contract.log"
    handler = logging.handlers.RotatingFileHandler(
        logfile, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False
    return logfile
