"""Manifiesto de un agente: todo lo que lo identifica, declarado como datos y no como código (ADR-013)."""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")  # el mismo patrón que `public.agents.id`
RESERVED_NAMES = frozenset({"apeiron", "human"})  # orquestador y participante humano (ADR-013)
RESERVED_PREFIXES = ("apeiron_", "__")  # nodos del grafo raíz y nodos internos de LangGraph
MAX_STEPS = 8
# Siluetas que sabe construir el motor de la Polis (apps/web/.../engine/places.ts).
LANDMARKS = frozenset({"gnomon", "fire", "summit", "workshop", "garden", "temple", "library", "abacus", "well"})
SIMULATION_KEYS = ("query", "thesis", "objection")
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# Identificador de una figura del catálogo de la Polis (`characters/manifest.json`); cuál existe lo decide la web.
_FIGURE_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


@dataclass(frozen=True)
class AgentCardInfo:
    """Lo que el agente anuncia de sí mismo en su Agent Card A2A y como skill de Ápeiron."""

    description: str
    tags: tuple[str, ...] = ()
    examples: tuple[str, ...] = ()


@dataclass(frozen=True)
class Residence:
    """Su lugar en la Polis (ADR-013): el frontend lo dibuja sin conocer al agente."""

    title: str
    subtitle: str
    landmark: str = "temple"
    color: str = "#c7889e"
    epithet: str = ""  # una línea que lo presenta al acercarse
    figure: str = ""  # su aspecto (estatua, personaje animado…); vacío = el de su clase


@dataclass(frozen=True)
class AgentSpec:
    name: str
    display_name: str
    role: str
    persona: str
    card: AgentCardInfo
    residence: Residence
    tools: tuple[str, ...] = ()
    hints: tuple[str, ...] = ()  # palabras que lo eligen en modo `single` (además de su nombre)
    debate: bool = False  # participa en el debate por defecto
    a2a: bool = False  # se publica como agente A2A propio (card y endpoint)
    max_steps: int | None = None  # tope propio de pasos ReAct (≤ el global)
    order: int = 100
    version: str = "1.0.0"
    simulation: Mapping[str, str] = field(default_factory=dict)  # postura del FakeLLM: query, thesis, objection

    def __post_init__(self) -> None:
        validate_spec(self)

    @property
    def routing_hints(self) -> tuple[str, ...]:
        """Su nombre siempre lo elige; después, las pistas declaradas."""
        return tuple(dict.fromkeys((self.name, self.display_name, *self.hints)))


def validate_spec(spec: AgentSpec) -> None:
    """Invariantes del manifiesto. Un agente mal declarado no arranca: falla al cargar el catálogo."""
    problems: list[str] = []
    if not NAME_RE.match(spec.name):
        problems.append("name debe cumplir ^[a-z][a-z0-9_]{1,40}$")
    if spec.name in RESERVED_NAMES or spec.name.startswith(RESERVED_PREFIXES):
        problems.append(f"name {spec.name!r} está reservado")
    for label, value in (("display_name", spec.display_name), ("role", spec.role), ("persona", spec.persona)):
        if not value.strip():
            problems.append(f"{label} no puede estar vacío")
    if spec.display_name.casefold() not in spec.persona.casefold():
        problems.append("la persona debe nombrar al agente (p. ej. «Eres Feynman»)")
    if len(set(spec.tools)) != len(spec.tools):
        problems.append("tools tiene duplicados")
    if spec.max_steps is not None and not 1 <= spec.max_steps <= MAX_STEPS:
        problems.append(f"max_steps debe estar entre 1 y {MAX_STEPS}")
    if not spec.card.description.strip():
        problems.append("card.description no puede estar vacía")
    if spec.residence.landmark not in LANDMARKS:
        problems.append(f"residence.landmark debe ser uno de {sorted(LANDMARKS)}")
    if not _COLOR_RE.match(spec.residence.color):
        problems.append("residence.color debe ser #rrggbb")
    if spec.residence.figure and not _FIGURE_RE.match(spec.residence.figure):
        problems.append("residence.figure debe cumplir ^[a-z][a-z0-9_]{0,31}$")
    if missing := [k for k in SIMULATION_KEYS if spec.simulation and not spec.simulation.get(k)]:
        problems.append(f"simulation incompleta: falta {', '.join(missing)}")
    if problems:
        raise ValueError(f"manifiesto del agente {spec.name!r} inválido: " + "; ".join(problems))
