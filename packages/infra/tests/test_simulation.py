"""La simulación (FakeLLM) demuestra la comunicación agéntica con datos reales del grafo."""

from apeiron_agents import load_catalog
from apeiron_core.application.agents.factories import SpecAgentFactory
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_infra.llm.fake import FakeLLM
from apeiron_infra.memory.vector import InMemoryVectorStore, seed_global
from apeiron_infra.tools.vector_memory import VectorMemoryRetriever

CATALOG = {spec.name: spec for spec in load_catalog()}


def fake_llm() -> FakeLLM:
    """El FakeLLM recibe la postura y el nombre visible de cada agente desde su manifiesto (ADR-013)."""
    return FakeLLM(
        stances={n: s.simulation for n, s in CATALOG.items()},
        labels={n: s.display_name for n, s in CATALOG.items()},
    )


def register(registry: AgentRegistry, *names: str) -> None:
    for name in names:
        registry.register(SpecAgentFactory(CATALOG[name]))


async def test_simulated_debate_cites_evidence_and_replies_to_interlocutor():
    store = InMemoryVectorStore()
    await seed_global(store)
    tools = {"vector_memory_retriever": VectorMemoryRetriever(store)}
    registry = AgentRegistry()
    register(registry, "anaximandro", "heraclito")
    llm = fake_llm()
    graph = build_graph(registry.build_all(llm, tools, max_steps=2), llm)

    out = await graph.ainvoke({"question": "Debate: ¿todo fluye?", "mode": "debate", "max_rounds": 1})
    anaximandro, heraclito = (t["text"] for t in out["turns"])

    assert "ápeiron" in anaximandro and "Evidencia recuperada" in anaximandro
    assert "Respondo a" not in anaximandro  # habla primero: no tiene a quién responder
    assert "Respondo a Anaximandro" in heraclito  # replica citando la posición del otro
    assert "devenir" in heraclito and "Evidencia recuperada" in heraclito
    assert "Anaximandro sostuvo" in out["answer"] and "Heráclito sostuvo" in out["answer"]
    assert "2 perspectivas distintas" in out["answer"]


async def test_simulated_remote_stand_in_is_a_worker_not_the_moderator():
    from apeiron_core.application.agents.factories import RemoteAgentFactory

    store = InMemoryVectorStore()
    await seed_global(store)
    tools = {"vector_memory_retriever": VectorMemoryRetriever(store)}
    registry = AgentRegistry()
    register(registry, "anaximandro")
    registry.register(RemoteAgentFactory("sophos", "Socio remoto."))
    llm = fake_llm()
    graph = build_graph(registry.build_all(llm, tools, max_steps=2), llm, 1)
    out = await graph.ainvoke({"question": "Debate: ¿qué es el cambio?", "max_rounds": 1})
    sophos = out["turns"][1]
    assert sophos["agent"] == "sophos" and not sophos["degraded"]
    assert "Respondo a Anaximandro" in sophos["text"] and "Síntesis" not in sophos["text"]


async def test_five_citizens_debate_with_distinct_perspectives_in_simulation():
    """Eval determinista (ADR-013, fase 3): cada ciudadano aporta una función cognitiva distinta."""
    store = InMemoryVectorStore()
    await seed_global(store)
    tools = {"vector_memory_retriever": VectorMemoryRetriever(store)}
    registry = AgentRegistry()
    roster = ["anaximandro", "heraclito", "nietzsche", "feynman", "epicuro"]
    register(registry, *roster)
    llm = fake_llm()
    graph = build_graph(registry.build_all(llm, tools, max_steps=2), llm, debate_participants=roster)

    out = await graph.ainvoke({"question": "Debate: ¿desplegamos 30 agentes?", "mode": "debate", "max_rounds": 1})
    texts = {t["agent"]: t["text"] for t in out["turns"]}

    assert list(texts) == roster  # los cinco a la vez, en orden
    assert len(set(texts.values())) == 5  # ninguna intervención repite a otra
    assert "genealogía" in texts["nietzsche"]  # crítica de valores
    assert "experimento" in texts["feynman"]  # verificación
    assert "consecuencias" in texts["epicuro"]  # prudencia
    assert all("Respondo a" in texts[name] for name in roster[1:])  # todos replican a una posición previa
    assert [t["responds_to"] for t in out["turns"]] == [None, *roster[:-1]]  # interlocutor real: el anterior
    assert "5 perspectivas distintas" in out["answer"]


def test_catalog_declares_the_five_citizens_with_their_access():
    assert list(CATALOG) == ["anaximandro", "heraclito", "nietzsche", "feynman", "epicuro"]
    assert CATALOG["nietzsche"].tools == ("vector_memory_retriever", "scholarly_search")
    assert all(spec.a2a and spec.simulation for spec in CATALOG.values())
    assert [n for n, s in CATALOG.items() if s.debate] == ["anaximandro", "heraclito"]
