"""Políticas deterministas de guardrails (0 tokens): inyección, secretos, protocolo y citas.

Cada función devuelve el texto (saneado o no) y las reglas que se activaron. Son
conservadoras a propósito: un patrón solo cuenta si apunta a las instrucciones del
sistema, no si la pregunta habla de "reglas" o "instrucciones" en general.
"""

import re
from collections.abc import Iterable

MAX_OBSERVATION_CHARS = 4000
REMOVED_LINE = "[fragmento retirado por guardrail: {rule}]"
UNVERIFIED = "[cita no verificada]"
NO_EVIDENCE_NOTE = (
    " [Ápeiron: este turno menciona evidencia, pero no se consultó ninguna herramienta; "
    "trátalo como opinión sin respaldo.]"
)

_I = re.IGNORECASE
_INJECTION = (
    re.compile(
        r"\b(?:ignore|disregard|forget|override)\b[^\n]{0,30}?\b(?:previous|prior|above|earlier|"
        r"preceding|initial|original|system|your)\s+(?:instructions?|prompts?|rules|directives)\b",
        _I,
    ),
    re.compile(
        r"\b(?:ignor|olvid|omit|descart|anul)\w*\b[^\n]{0,30}?\b(?:instrucci[oó]n(?:es)?|indicaciones|"
        r"reglas|directrices)\s+(?:anteriores|previas|del sistema|iniciales|originales)\b",
        _I,
    ),
    re.compile(r"\b(?:ignor|olvid)\w*\s+(?:todas\s+)?tus\s+(?:instrucciones|reglas|directrices)\b", _I),
    re.compile(
        r"\b(?:reveal|show|print|repeat|output|leak)\b[^\n]{0,30}?\b(?:system prompt|your "
        r"(?:instructions|prompt|rules))\b",
        _I,
    ),
    re.compile(
        r"\b(?:revela|muestra|imprime|repite|dime|escribe)\b[^\n]{0,30}?\b(?:(?:tu|el) prompt|"
        r"prompt del sistema|tus instrucciones|las instrucciones del sistema)\b",
        _I,
    ),
    re.compile(
        r"\b(?:act|respond|behave)\s+as\b[^\n]{0,30}?\b(?:unrestricted|unfiltered|jailbroken|"
        r"without (?:any )?(?:restrictions|filters))\b",
        _I,
    ),
    re.compile(
        r"\b(?:act[úu]a|comp[oó]rtate|responde)\s+como\b[^\n]{0,30}?\bsin (?:restricciones|filtros|"
        r"l[ií]mites)\b",
        _I,
    ),
    re.compile(r"\b(?:developer mode|modo desarrollador)\b", _I),
)
_ROLE_SPOOF = (
    re.compile(r"<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[/?INST\]|<</?SYS>>", _I),
    re.compile(r"^\s*(?:#{1,3}\s*)?(?:system|sistema|developer|assistant|asistente)\s*:", _I | re.M),
)
_PROTOCOL = re.compile(
    r"^(?P<lead>\s*\**\s*)(?P<marker>Thought|Action Input|Action|Observation|Reflect|Final Answer)"
    r"\s*\**\s*:",
    _I | re.M,
)
_PRIVATE_LINE = re.compile(
    r"^\s*\**\s*(?:Thought|Reflect|Action Input|Action|Observation)\s*\**\s*:.*(?:\n|$)", _I | re.M
)
_FINAL_MARKER = re.compile(r"^\s*\**\s*Final Answer\s*\**\s*:\s*", _I | re.M)

_SECRETS = (
    re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bsb_secret_[A-Za-z0-9_-]{10,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
)
_SECRET_ASSIGNMENT = re.compile(
    r"\b(?P<key>api[_-]?key|secret|token|password|contrase[ñn]a)\s*[:=]\s*\S{6,}", _I
)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_PHONE = re.compile(r"(?<![\w+])\+\d[\d \-]{7,14}\d\b")

_URL = re.compile(r"https?://[^\s<>()\[\]«»\"']+", _I)
_ARXIV_ID = re.compile(r"\b(?:arXiv:\s*)?(?P<id>\d{4}\.\d{4,5})(?:v\d+)?\b", _I)
_DOI = re.compile(r"\b10\.\d{4,9}/[^\s<>()\[\]«»\"']+")
_EVIDENCE_CLAIM = re.compile(
    r"\[source=\w+\]|evidencia recuperada|evidence retrieved|seg[uú]n (?:la memoria|arxiv|la herramienta)|"
    r"according to (?:arxiv|the tool|memory)",
    _I,
)
_TRAILING = ".,;:!?»"


def _neutralize_lines(text: str, rule: str, patterns: Iterable[re.Pattern[str]]) -> tuple[str, bool]:
    lines, hit = [], False
    for line in text.split("\n"):
        if any(p.search(line) for p in patterns):
            lines.append(REMOVED_LINE.format(rule=rule))
            hit = True
        else:
            lines.append(line)
    return "\n".join(lines), hit


def detect_injection(text: str) -> list[str]:
    """Reglas de inyección directa presentes en el texto (para bloquear la entrada)."""
    rules = []
    if any(p.search(text) for p in _INJECTION):
        rules.append("prompt_injection")
    if any(p.search(text) for p in _ROLE_SPOOF):
        rules.append("role_spoofing")
    return rules


def neutralize_injection(text: str) -> tuple[str, list[str]]:
    """Sustituye las líneas con instrucciones inyectadas (inyección indirecta)."""
    text, injection = _neutralize_lines(text, "prompt_injection", _INJECTION)
    text, spoof = _neutralize_lines(text, "role_spoofing", _ROLE_SPOOF)
    return text, [r for r, hit in (("prompt_injection", injection), ("role_spoofing", spoof)) if hit]


def defang_protocol(text: str) -> tuple[str, list[str]]:
    """`Observation: x` en datos ajenos -> `Observation (citado) - x`: no suplanta al protocolo ReAct."""
    out, n = _PROTOCOL.subn(lambda m: f"{m['lead']}{m['marker']} (citado) -", text)
    return out, ["protocol_spoofing"] if n else []


def drop_private_reasoning(text: str) -> tuple[str, list[str]]:
    """Quita líneas del protocolo ReAct (Thought, Action...) que se filtren a un texto público."""
    out, n = _PRIVATE_LINE.subn("", text)
    out, m = _FINAL_MARKER.subn("", out)
    return out.strip(), ["reasoning_leak"] if n or m else []


def redact_sensitive(text: str, pii: bool = True) -> tuple[str, list[str]]:
    rules = []
    for pattern in _SECRETS:
        text, n = pattern.subn("[secreto retirado]", text)
        if n and "secret" not in rules:
            rules.append("secret")
    text, n = _SECRET_ASSIGNMENT.subn(lambda m: f"{m['key']}=[secreto retirado]", text)
    if n and "secret" not in rules:
        rules.append("secret")
    if pii:
        text, emails = _EMAIL.subn("[correo retirado]", text)
        text, phones = _PHONE.subn("[teléfono retirado]", text)
        if emails or phones:
            rules.append("pii")
    return text, rules


def truncate(text: str, limit: int = MAX_OBSERVATION_CHARS) -> tuple[str, list[str]]:
    if len(text) <= limit:
        return text, []
    return text[:limit] + " […]", ["oversized"]


def _normalize(text: str) -> str:
    return re.sub(r"https?://(?:www\.)?", "", text.lower()).rstrip("/")


def ground_citations(text: str, evidence: Iterable[str]) -> tuple[str, list[str]]:
    """Remedia alucinaciones verificables: URLs, ids de arXiv y DOIs que no salen de la evidencia.

    Una cita está respaldada si aparece en alguna observación real de esta ejecución. Si no,
    se sustituye por `[cita no verificada]`; el resto del texto se conserva.
    """
    corpus = _normalize("\n".join(evidence))
    removed = 0

    def check(token: str, key: str) -> str:
        nonlocal removed
        clean = token.rstrip(_TRAILING)
        if key and key in corpus:
            return token
        removed += 1
        return UNVERIFIED + token[len(clean):]

    def url(m: re.Match[str]) -> str:
        clean = m.group(0).rstrip(_TRAILING)
        arxiv = _ARXIV_ID.search(clean)
        if arxiv and arxiv["id"] in corpus:
            return m.group(0)
        return check(m.group(0), _normalize(clean))

    text = _URL.sub(url, text)
    text = _DOI.sub(lambda m: check(m.group(0), m.group(0).rstrip(_TRAILING).lower()), text)
    text = _ARXIV_ID.sub(lambda m: check(m.group(0), m["id"]), text)
    return text, ["ungrounded_citation"] if removed else []


def claims_evidence(text: str) -> bool:
    return bool(_EVIDENCE_CLAIM.search(text))
