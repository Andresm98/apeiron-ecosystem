"""Métricas del eval de diferenciación (sin LLM): enmascarado, solapamiento y turnos degradados."""

from apeiron_api.container import agent_catalog
from apeiron_api.evals.differentiation import Turn, bag, cosine, mask, summarize


def test_mask_hides_every_catalog_name():
    masked = mask("Como diría Heráclito, y no Feynman ni heraclito, todo fluye.", agent_catalog())
    assert "Heráclito" not in masked and "Feynman" not in masked and "heraclito" not in masked
    assert masked.count("[ciudadano]") == 3


def test_lexical_overlap_ignores_stopwords():
    assert round(cosine(bag("el devenir del logos"), bag("devenir y logos")), 6) == 1.0
    assert cosine(bag("experimento causal"), bag("prudencia serena")) == 0.0


def test_degraded_turns_do_not_count_as_attributions():
    specs = agent_catalog()
    turns = [
        Turn(0, "feynman", "Mecanismo, experimento.", False),
        Turn(0, "feynman", "[feynman: no se obtuvo una respuesta final válida]", True),
        Turn(0, "epicuro", "Lo suficiente basta.", False),
    ]
    result = summarize(turns, ["feynman", "feynman", "nietzsche"], specs)
    assert result["valid_turns"] == 2 and result["accuracy"] == 0.5  # el degradado no suma un acierto
    assert result["degraded_by_agent"]["feynman"] == 1
    assert result["confusion"]["feynman"]["feynman"] == 1
