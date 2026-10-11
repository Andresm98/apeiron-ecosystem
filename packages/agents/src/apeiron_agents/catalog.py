"""Carga y valida los manifiestos de agentes. Sin dependencias: `tomllib` es de la biblioteca estándar."""

import hashlib
import json
import tomllib
from collections.abc import Iterable
from importlib.resources import files
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Any

from apeiron_core.domain.entities.agent_spec import AgentCardInfo, AgentSpec, Residence

MANIFEST = "agent.toml"
PERSONA = "persona.md"
_SECTION_KEYS = {
    "access": {"tools", "a2a", "max_steps"},
    "routing": {"hints"},
    "card": {"description", "tags", "examples"},
    "residence": {"title", "subtitle", "landmark", "color", "epithet", "figure"},
    "simulation": {"query", "thesis", "objection"},
}
_TOP_LEVEL = {"name", "display_name", "role", "version", "order", "debate", *_SECTION_KEYS}


def _strings(value: Any, where: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValueError(f"{where} debe ser una lista de textos")
    return tuple(value)


def _section(data: dict[str, Any], key: str, where: str) -> dict[str, Any]:
    value = data.get(key, {})
    if not isinstance(value, dict):
        raise ValueError(f"{where}: [{key}] debe ser una tabla")
    if unknown := set(value) - _SECTION_KEYS[key]:
        raise ValueError(f"{where}: claves desconocidas en [{key}]: {sorted(unknown)}")
    return value


def load_spec(folder: Traversable | Path) -> AgentSpec:
    """Un agente desde su carpeta. El nombre de la carpeta debe coincidir con `name`."""
    where = f"agente {folder.name!r}"
    try:
        data = tomllib.loads((folder / MANIFEST).read_text(encoding="utf-8"))
        persona = (folder / PERSONA).read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise ValueError(f"{where}: falta {MANIFEST} o {PERSONA}") from exc
    if unknown := set(data) - _TOP_LEVEL:
        raise ValueError(f"{where}: claves desconocidas {sorted(unknown)}")
    if data.get("name") != folder.name:
        raise ValueError(f"{where}: name debe coincidir con el nombre de la carpeta")
    access = _section(data, "access", where)
    card = _section(data, "card", where)
    residence = _section(data, "residence", where)
    simulation = _section(data, "simulation", where)
    if not {"title", "subtitle"} <= set(residence):
        raise ValueError(f"{where}: [residence] necesita title y subtitle")
    return AgentSpec(
        name=data["name"],
        display_name=str(data.get("display_name", "")),
        role=str(data.get("role", "")),
        persona=persona,
        version=str(data.get("version", "1.0.0")),
        order=int(data.get("order", 100)),
        debate=bool(data.get("debate", False)),
        tools=_strings(access.get("tools", []), f"{where}: access.tools"),
        a2a=bool(access.get("a2a", False)),
        max_steps=access.get("max_steps"),
        hints=_strings(_section(data, "routing", where).get("hints", []), f"{where}: routing.hints"),
        card=AgentCardInfo(
            description=str(card.get("description", "")),
            tags=_strings(card.get("tags", []), f"{where}: card.tags"),
            examples=_strings(card.get("examples", []), f"{where}: card.examples"),
        ),
        residence=Residence(**{k: str(v) for k, v in residence.items()}),
        simulation={k: str(v) for k, v in simulation.items()},
    )


def load_catalog(root: Traversable | Path | None = None) -> list[AgentSpec]:
    """Todos los agentes del catálogo, en orden (`order`, luego `name`). Falla si alguno es inválido.

    `root` permite cargar un catálogo externo (p. ej. en tests); por defecto, las carpetas de este paquete.
    """
    base = root if root is not None else files("apeiron_agents")
    folders = [
        entry for entry in base.iterdir()
        if entry.is_dir() and not entry.name.startswith(("_", ".")) and (entry / MANIFEST).is_file()
    ]
    specs = sorted((load_spec(folder) for folder in folders), key=lambda s: (s.order, s.name))
    seen: set[str] = set()
    for spec in specs:
        if spec.name in seen:
            raise ValueError(f"agente duplicado en el catálogo: {spec.name!r}")
        seen.add(spec.name)
    return specs


def catalog_rows(specs: Iterable[AgentSpec]) -> list[dict[str, Any]]:
    """Lo que el catálogo SQL (`public.agents`) guarda de cada worker."""
    return [
        {"id": s.name, "display_name": s.display_name, "kind": "worker", "role": s.role, "tools": list(s.tools)}
        for s in sorted(specs, key=lambda s: s.name)
    ]


def catalog_digest(specs: Iterable[AgentSpec]) -> str:
    """Huella del catálogo SQL: si cambia, hace falta una migración nueva (`python -m apeiron_agents migration`)."""
    payload = json.dumps(catalog_rows(specs), ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
