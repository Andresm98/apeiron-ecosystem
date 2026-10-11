"""Catálogo de agentes (ADR-013): una carpeta por agente, validada al cargar y alineada con Supabase."""

import re
from pathlib import Path

import pytest

from apeiron_agents import catalog_digest, load_catalog, load_spec
from apeiron_agents.__main__ import DIGEST_MARK, migration_sql

MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"

MANIFEST = """
name = "socrates"
display_name = "Sócrates"
role = "Mayéutica."

[access]
tools = ["vector_memory_retriever"]

[card]
description = "Pregunta hasta que el otro descubre lo que no sabe."

[residence]
title = "El Pórtico"
subtitle = "Preguntas"
landmark = "temple"
color = "#aabbcc"
"""


def write_agent(root: Path, folder: str, manifest: str = MANIFEST, persona: str = "Eres Sócrates.") -> Path:
    agent = root / folder
    agent.mkdir()
    (agent / "agent.toml").write_text(manifest, encoding="utf-8")
    (agent / "persona.md").write_text(persona, encoding="utf-8")
    return agent


def test_packaged_catalog_loads_every_agent_in_order():
    specs = load_catalog()
    assert [s.name for s in specs] == ["anaximandro", "heraclito", "nietzsche", "feynman", "epicuro"]
    feynman = specs[3]
    assert feynman.display_name == "Feynman" and feynman.persona.startswith("Eres Feynman")
    assert feynman.residence.landmark == "workshop" and feynman.card.examples
    assert {spec.residence.figure for spec in specs} == {"philosopher"}  # los cinco pensadores son estatuas vivas
    assert "experimento" in feynman.routing_hints and feynman.simulation["thesis"]


def test_a_new_agent_is_just_a_folder(tmp_path: Path):
    write_agent(tmp_path, "socrates")
    (spec,) = load_catalog(tmp_path)
    assert spec.name == "socrates" and spec.tools == ("vector_memory_retriever",)
    assert not spec.debate and not spec.a2a and spec.order == 100


BAD_FIGURE = MANIFEST.replace('landmark = "temple"', 'landmark = "temple"\nfigure = "Darth Vader"')


@pytest.mark.parametrize(
    ("folder", "manifest", "persona", "error"),
    [
        ("platon", MANIFEST, "Eres Sócrates.", "nombre de la carpeta"),
        ("socrates", MANIFEST + "\nsecret = 1\n", "Eres Sócrates.", "claves desconocidas"),
        ("socrates", MANIFEST, "Eres un filósofo.", "nombrar al agente"),
        ("socrates", MANIFEST.replace('"temple"', '"castillo"'), "Eres Sócrates.", "landmark"),
        ("socrates", BAD_FIGURE, "Eres Sócrates.", "figure"),
        ("socrates", MANIFEST.replace('["vector_memory_retriever"]', '"todas"'), "Eres Sócrates.", "lista"),
    ],
)
def test_invalid_manifests_fail_at_load(tmp_path: Path, folder: str, manifest: str, persona: str, error: str):
    agent = write_agent(tmp_path, folder, manifest, persona)
    with pytest.raises(ValueError, match=error):
        load_spec(agent)


def test_missing_persona_fails(tmp_path: Path):
    agent = write_agent(tmp_path, "socrates")
    (agent / "persona.md").unlink()
    with pytest.raises(ValueError, match="persona.md"):
        load_spec(agent)


def test_supabase_catalog_is_in_sync_with_the_manifests():
    """Si cambia un manifiesto (rol, tools, nombre visible) hace falta una migración generada nueva."""
    digests = [
        (path.name, match.group(1))
        for path in sorted(MIGRATIONS.glob("*.sql"))
        if (match := re.search(rf"^{re.escape(DIGEST_MARK)} (\w+)$", path.read_text(encoding="utf-8"), re.M))
    ]
    assert digests, "falta la migración generada: python -m apeiron_agents migration --write supabase/migrations"
    latest_file, latest = digests[-1]
    assert latest == catalog_digest(load_catalog()), (
        f"{latest_file} no refleja los manifiestos actuales: "
        "python -m apeiron_agents migration --write supabase/migrations"
    )


def test_generated_migration_upserts_workers_and_retires_missing_ones():
    sql = migration_sql()
    assert "('feynman', 'Feynman', 'worker'," in sql and "on conflict (id) do update" in sql
    assert "active = false" in sql and "'epicuro'" in sql.split("not in (")[1]
