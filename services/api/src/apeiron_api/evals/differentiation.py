"""Eval de diferenciación con LLM real (ADR-013): ¿se reconoce a cada ciudadano por la función que declara?

Consume tokens: exige `--yes`. Usa la misma composición que la API (catálogo, tools, guardrails, LLM del `.env`).

1. Debates de una ronda con todos los agentes del catálogo sobre preguntas variadas.
2. Atribución ciega: un juez LLM recibe cada intervención, con los nombres de los agentes enmascarados, y las
   descripciones públicas de sus funciones (las de la Agent Card) en orden aleatorio, y elige cuál la escribió.
   El azar acierta 1/N; un ciudadano bien diferenciado se reconoce casi siempre.
3. Solapamiento léxico entre agentes sobre la misma pregunta (coseno de bolsas de palabras; menos es mejor).

    python -m apeiron_api.evals.differentiation --yes --label baseline --out docs/evals
"""

import argparse
import asyncio
import hashlib
import json
import math
import random
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from apeiron_api.container import _build_llm, _build_store, _build_tools, agent_catalog, build_apeiron_graph
from apeiron_api.settings import Settings
from apeiron_core.application.usage import TokenUsage, current_agent, usage_meter
from apeiron_core.domain.entities.agent_spec import AgentSpec
from apeiron_infra.memory.vector import seed_global

QUESTIONS = (
    "¿Deberíamos desplegar 30 agentes de IA en Kubernetes para atender a nuestros clientes?",
    "¿Es el cambio la sustancia de la realidad?",
    "¿Debería una ciudad prohibir los coches en su centro histórico?",
    "¿Qué hace que una explicación científica sea buena?",
    "¿Conviene que un equipo de cinco personas adopte microservicios?",
    "¿Es la felicidad el fin último de la vida humana?",
)
JUDGE = "juez"
JUDGE_SYSTEM = (
    "Eres un evaluador imparcial de debates. Recibirás una intervención y varias funciones posibles, "
    "identificadas con letras. Elige la función que mejor describe lo que hace la intervención (su método y "
    "su foco), no el tema. Responde solo con la letra."
)
_WORD_RE = re.compile(r"[a-zñ]{4,}")
_STOPWORDS = frozenset(
    "como pero para porque sobre entre cuando donde desde hasta esta este esto estos estas eso esos esas "
    "solo también tiene tienen puede pueden hace hacer cada todo toda todos todas otro otra otros otras "
    "mismo misma sino aunque según sobre nuestro nuestra ellos ellas porque quien quienes cual cuales "
    "respondo afirma sostengo pregunta respuesta debate ronda".split()
)


@dataclass
class Turn:
    question: int
    agent: str
    text: str
    degraded: bool


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c))


def mask(text: str, specs: list[AgentSpec]) -> str:
    """Oculta todos los nombres del catálogo: el juez debe reconocer la función, no la firma."""
    for spec in specs:
        for name in {spec.name, spec.display_name, _fold(spec.display_name)}:
            text = re.sub(rf"\b{re.escape(name)}\b", "[ciudadano]", text, flags=re.I)
    return text


def bag(text: str) -> Counter[str]:
    return Counter(w for w in _WORD_RE.findall(_fold(text)) if w not in _STOPWORDS)


def cosine(a: Counter[str], b: Counter[str]) -> float:
    dot = sum(a[w] * b[w] for w in a.keys() & b.keys())
    norm = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
    return dot / norm if norm else 0.0


def persona_digest(specs: list[AgentSpec]) -> str:
    payload = "\n".join(f"{s.name}:{s.version}:{s.persona}" for s in specs)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


async def debate(graph: Any, question: str, roster: list[str], index: int) -> list[Turn]:
    out = await graph.ainvoke({"question": question, "mode": "debate", "participants": roster, "max_rounds": 1})
    return [Turn(index, t["agent"], t["text"], t["degraded"]) for t in out["turns"]]


async def attribute(llm: Any, turn: Turn, specs: list[AgentSpec], rng: random.Random) -> str:
    options = specs[:]
    rng.shuffle(options)
    letters = "ABCDEFGH"[: len(options)]
    listing = "\n".join(f"{letter}. {spec.card.description}" for letter, spec in zip(letters, options, strict=True))
    prompt = f"Funciones:\n{listing}\n\nIntervención:\n«{mask(turn.text, specs)}»\n\nLetra:"
    token = current_agent.set(JUDGE)
    try:
        reply = await llm.complete(JUDGE_SYSTEM, prompt)
    finally:
        current_agent.reset(token)
    match = re.search(rf"\b([{letters}])\b", reply.strip().upper())
    return options[letters.index(match.group(1))].name if match else "?"


def summarize(turns: list[Turn], guesses: list[str], specs: list[AgentSpec]) -> dict[str, Any]:
    names = [s.name for s in specs]
    confusion = {a: dict.fromkeys([*names, "?"], 0) for a in names}
    # Un turno degradado no es una intervención: no cuenta para la atribución (se informa aparte).
    valid = [(t, g) for t, g in zip(turns, guesses, strict=True) if not t.degraded]
    for turn, guess in valid:
        confusion[turn.agent][guess] += 1
    per_agent = {
        a: round(confusion[a][a] / max(sum(confusion[a].values()), 1), 2) for a in names
    }
    hits = sum(confusion[a][a] for a in names)
    overlap: dict[str, list[float]] = {}
    for q in sorted({t.question for t in turns}):
        same = [t for t in turns if t.question == q and not t.degraded]
        for i, a in enumerate(same):
            for b in same[i + 1 :]:
                key = "-".join(sorted((a.agent, b.agent)))
                overlap.setdefault(key, []).append(cosine(bag(a.text), bag(b.text)))
    pairs = {k: round(sum(v) / len(v), 3) for k, v in sorted(overlap.items())}
    lengths = {a: round(sum(len(t.text.split()) for t in turns if t.agent == a) / max(
        sum(1 for t in turns if t.agent == a), 1)) for a in names}
    return {
        "accuracy": round(hits / max(len(valid), 1), 3),
        "valid_turns": len(valid),
        "chance": round(1 / len(names), 3),
        "per_agent": per_agent,
        "confusion": confusion,
        "lexical_overlap_mean": round(sum(pairs.values()) / max(len(pairs), 1), 3),
        "lexical_overlap_pairs": pairs,
        "words_per_turn": lengths,
        "degraded": sum(t.degraded for t in turns),
        "degraded_by_agent": {a: sum(t.degraded for t in turns if t.agent == a) for a in names},
    }


def markdown(label: str, meta: dict[str, Any], result: dict[str, Any], specs: list[AgentSpec]) -> str:
    names = [s.name for s in specs]
    head = "| autor \\ juez | " + " | ".join(names) + " | ? |\n|" + "---|" * (len(names) + 2) + "\n"
    rows = "".join(
        f"| **{a}** | " + " | ".join(str(result["confusion"][a][g]) for g in [*names, "?"]) + " |\n" for a in names
    )
    worst = sorted(result["lexical_overlap_pairs"].items(), key=lambda kv: -kv[1])[:3]
    return (
        f"# Eval de diferenciación · {label}\n\n"
        f"- Fecha: {meta['date']} · modelo `{meta['model']}` · personas `{meta['personas']}`\n"
        f"- {meta['questions']} preguntas × {len(names)} agentes = {meta['turns']} intervenciones "
        f"(degradadas: {result['degraded']})\n"
        f"- Coste: {meta['usage']['calls']} llamadas, {meta['usage']['total_tokens']} tokens "
        f"(debates {meta['usage_debate']} · juez {meta['usage_judge']})\n\n"
        f"**Atribución ciega: {result['accuracy']:.0%}** sobre {result['valid_turns']} intervenciones válidas "
        f"(azar: {result['chance']:.0%}). Turnos degradados, excluidos: {result['degraded_by_agent']}\n\n"
        "| agente | acierto | palabras/turno |\n|---|---|---|\n"
        + "".join(f"| {a} | {result['per_agent'][a]:.0%} | {result['words_per_turn'][a]} |\n" for a in names)
        + f"\nMatriz de confusión:\n\n{head}{rows}\n"
        f"Solapamiento léxico medio entre agentes (coseno): **{result['lexical_overlap_mean']}**. "
        "Pares más parecidos: " + ", ".join(f"{k} {v}" for k, v in worst) + "\n"
    )


async def run(label: str, limit: int, seed: int) -> dict[str, Any]:
    s = Settings()
    if s.llm_provider == "fake":
        raise SystemExit("APEIRON_LLM_PROVIDER=fake: este eval necesita un LLM real")
    s = s.model_copy(update={"vector_backend": "memory"})  # memoria aislada: no toca la del usuario
    specs = agent_catalog()
    roster = [spec.name for spec in specs]
    store = _build_store(s)
    await seed_global(store)
    meter = TokenUsage()
    usage_meter.set(meter)
    async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": "apeiron-eval/0.1"}) as http:
        graph = build_apeiron_graph(s, _build_tools(s, http, store))
        started = time.perf_counter()
        turns: list[Turn] = []
        for index, question in enumerate(QUESTIONS[:limit]):
            turns += await debate(graph, question, roster, index)
            print(f"  debate {index + 1}/{limit}: {len(turns)} intervenciones, {meter.calls} llamadas")
        debate_usage = meter.as_dict()["total_tokens"]
        judge = _build_llm(s)
        rng = random.Random(seed)
        guesses = [await attribute(judge, turn, specs, rng) for turn in turns]
    result = summarize(turns, guesses, specs)
    usage = meter.as_dict()
    meta = {
        "label": label,
        "date": time.strftime("%Y-%m-%d %H:%M"),
        "model": f"{s.llm_provider}:{s.llm_model}" + (f" ({s.llm_reasoning_effort})" if s.llm_reasoning_effort else ""),
        "personas": persona_digest(specs),
        "versions": {spec.name: spec.version for spec in specs},
        "questions": limit,
        "turns": len(turns),
        "seconds": round(time.perf_counter() - started),
        "usage": usage,
        "usage_debate": debate_usage,
        "usage_judge": usage["total_tokens"] - debate_usage,
    }
    detail = [{**t.__dict__, "judged_as": g} for t, g in zip(turns, guesses, strict=True)]
    return {"meta": meta, "result": result, "turns": detail}


def save(report: dict[str, Any], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    stem = f"differentiation-{report['meta']['label']}"
    (out / f"{stem}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / f"{stem}.md").write_text(
        markdown(report["meta"]["label"], report["meta"], report["result"], agent_catalog()), encoding="utf-8"
    )


def rescore(path: Path) -> dict[str, Any]:
    """Recalcula las métricas de un informe guardado sin volver a llamar al LLM (0 tokens)."""
    report: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    turns = [Turn(t["question"], t["agent"], t["text"], t["degraded"]) for t in report["turns"]]
    report["result"] = summarize(turns, [t["judged_as"] for t in report["turns"]], agent_catalog())
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="confirma que se gastarán tokens del proveedor real")
    parser.add_argument("--label", default="run")
    parser.add_argument("--out", type=Path, default=Path("docs/evals"))
    parser.add_argument("--questions", type=int, default=len(QUESTIONS), choices=range(1, len(QUESTIONS) + 1))
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--rescore", type=Path, metavar="JSON", help="recalcula un informe guardado (0 tokens)")
    args = parser.parse_args()
    if args.rescore:
        report = rescore(args.rescore)
        save(report, args.rescore.parent)
        print(f"atribución {report['result']['accuracy']:.0%} · degradadas {report['result']['degraded_by_agent']}")
        return
    if not args.yes:
        raise SystemExit("Este eval llama al LLM real y consume tokens: añade --yes para confirmarlo.")
    # Las claves de proveedor (OPENAI_API_KEY...) las lee LangChain del entorno, como en Compose (`env_file`).
    load_dotenv(".env", override=False)
    report = asyncio.run(run(args.label, args.questions, args.seed))
    save(report, args.out)
    result = report["result"]
    print(f"atribución {result['accuracy']:.0%} (azar {result['chance']:.0%}) · por agente {result['per_agent']}")
    print(f"solapamiento léxico {result['lexical_overlap_mean']} · coste {report['meta']['usage']}")


if __name__ == "__main__":
    main()
