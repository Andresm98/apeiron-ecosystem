"""Actividad del proceso (en memoria, por instancia): qué está ocurriendo en el sistema ahora.

Solo agregados: nunca preguntas, respuestas ni identidades. Se reinicia con el proceso;
la historia durable está en `agent_runs` (Supabase) y en LangSmith.
"""

import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any

from apeiron_core.application.dto.runs import AgentRun


@dataclass
class RuntimeMetrics:
    started_at: float = field(default_factory=time.time)
    active_runs: int = 0
    statuses: Counter[str] = field(default_factory=Counter)
    channels: Counter[str] = field(default_factory=Counter)
    guardrails: Counter[str] = field(default_factory=Counter)  # "etapa:regla"
    llm_calls: int = 0
    total_tokens: int = 0
    duration_ms: deque[int] = field(default_factory=lambda: deque(maxlen=200))  # ventana de latencias
    failures: Counter[str] = field(default_factory=Counter)  # run_persist_failed, memorize_failed...
    last_failure_at: dict[str, float] = field(default_factory=dict)

    def run_started(self) -> None:
        self.active_runs += 1

    def run_finished(self) -> None:
        self.active_runs = max(0, self.active_runs - 1)

    def observe(self, run: AgentRun) -> None:
        self.statuses[run["status"]] += 1
        self.channels[run["channel"]] += 1
        for record in run["guardrails"]:
            for rule in record["rules"]:
                self.guardrails[f"{record['stage']}:{rule}"] += 1
        self.llm_calls += run["usage"].get("calls", 0)
        self.total_tokens += run["usage"].get("total_tokens", 0)
        self.duration_ms.append(run["duration_ms"])

    def failure(self, name: str) -> None:
        self.failures[name] += 1
        self.last_failure_at[name] = time.time()

    def snapshot(self) -> dict[str, Any]:
        latencies = sorted(self.duration_ms)
        return {
            "since": self.started_at,
            "active_runs": self.active_runs,
            "runs": sum(self.statuses.values()),
            "statuses": dict(self.statuses),
            "channels": dict(self.channels),
            "guardrails": dict(self.guardrails.most_common()),
            "llm_calls": self.llm_calls,
            "total_tokens": self.total_tokens,
            "latency_ms": {
                "p50": latencies[len(latencies) // 2] if latencies else None,
                "p95": latencies[int(len(latencies) * 0.95)] if latencies else None,
            },
            "failures": dict(self.failures),
            "last_failure_at": dict(self.last_failure_at),
        }
