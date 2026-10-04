"""La simulación (FakeLLM) demuestra la comunicación agéntica con datos reales del grafo."""

from apeiron_core.application.agents.factories import AnaximandroFactory, HeraclitoFactory
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_infra.llm.fake import FakeLLM
from apeiron_infra.memory.vector import InMemoryVectorStore, seed_global
from apeiron_infra.tools.vector_memory import VectorMemoryRetriever


async def test_simulated_debate_cites_evidence_and_replies_to_interlocutor():
    store = InMemoryVectorStore()
    await seed_global(store)
    tools = {"vector_memory_retriever": VectorMemoryRetriever(store)}
    registry = AgentRegistry()
    registry.register(AnaximandroFactory())
    registry.register(HeraclitoFactory())
    llm = FakeLLM()
    graph = build_graph(registry.build_all(llm, tools, max_steps=2), llm)

    out = await graph.ainvoke({"question": "Debate: ¿todo fluye?", "mode": "debate", "max_rounds": 1})
    anaximandro, heraclito = (t["text"] for t in out["turns"])

    assert "ápeiron" in anaximandro and "Evidencia recuperada" in anaximandro
    assert "Respondo a" not in anaximandro  # habla primero: no tiene a quién responder
    assert "Respondo a Anaximandro" in heraclito  # replica citando la posición del otro
    assert "devenir" in heraclito and "Evidencia recuperada" in heraclito
    assert "Anaximandro sostuvo" in out["answer"] and "Heráclito sostuvo" in out["answer"]
    assert "difieren en el fundamento" in out["answer"]
