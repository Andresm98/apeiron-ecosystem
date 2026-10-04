"""formal_logic_calculator: tablas de verdad y validez de argumentos (parser seguro, sin eval)."""
import itertools
import re
from collections.abc import Callable

Ast = tuple[object, ...]
_SYMBOLS = {"∧": "&", "∨": "|", "¬": "~", "→": "->", "↔": "<->", "⊢": "|-"}
_TOKEN = re.compile(r"\s*(<->|->|\|-|\||&|~|!|\(|\)|,|[A-Za-z_]\w*)")
_WORDS = {"and": "&", "or": "|", "not": "~", "implies": "->", "iff": "<->"}
MAX_VARS = 8


def _tokenize(text: str) -> list[str]:
    for sym, rep in _SYMBOLS.items():
        text = text.replace(sym, f" {rep} ")
    tokens, pos = [], 0
    while pos < len(text.rstrip()):
        m = _TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"carácter inesperado en posición {pos}: {text[pos]!r}")
        tok = m.group(1)
        tokens.append(_WORDS.get(tok.lower(), "~" if tok == "!" else tok))
        pos = m.end()
    return tokens


class _Parser:
    def __init__(self, tokens: list[str]) -> None:
        self.t, self.i = tokens, 0

    def peek(self) -> str | None:
        return self.t[self.i] if self.i < len(self.t) else None

    def eat(self) -> str:
        tok = self.peek()
        if tok is None:
            raise ValueError("fórmula incompleta")
        self.i += 1
        return tok

    def parse(self) -> Ast:
        node = self.iff()
        if self.peek() is not None:
            raise ValueError(f"token inesperado: {self.peek()!r}")
        return node

    def iff(self) -> Ast:
        node = self.imp()
        while self.peek() == "<->":
            self.eat()
            node = ("iff", node, self.imp())
        return node

    def imp(self) -> Ast:
        node = self.or_()
        if self.peek() == "->":
            self.eat()
            return ("imp", node, self.imp())  # asociatividad a la derecha
        return node

    def or_(self) -> Ast:
        node = self.and_()
        while self.peek() == "|":
            self.eat()
            node = ("or", node, self.and_())
        return node

    def and_(self) -> Ast:
        node = self.not_()
        while self.peek() == "&":
            self.eat()
            node = ("and", node, self.not_())
        return node

    def not_(self) -> Ast:
        if self.peek() == "~":
            self.eat()
            return ("not", self.not_())
        return self.atom()

    def atom(self) -> Ast:
        tok = self.eat()
        if tok == "(":
            node = self.iff()
            if self.eat() != ")":
                raise ValueError("falta ')'")
            return node
        if re.fullmatch(r"[A-Za-z_]\w*", tok):
            return ("var", tok)
        raise ValueError(f"token inesperado: {tok!r}")


def _vars(node: Ast, acc: set[str]) -> None:
    if node[0] == "var":
        acc.add(str(node[1]))
        return
    for child in node[1:]:
        _vars(child, acc)  # type: ignore[arg-type]


def _eval(node: Ast, env: dict[str, bool]) -> bool:
    op = node[0]
    if op == "var":
        return env[str(node[1])]
    a = _eval(node[1], env)  # type: ignore[arg-type]
    if op == "not":
        return not a
    b = _eval(node[2], env)  # type: ignore[arg-type]
    ops: dict[object, Callable[[bool, bool], bool]] = {
        "and": lambda x, y: x and y,
        "or": lambda x, y: x or y,
        "imp": lambda x, y: (not x) or y,
        "iff": lambda x, y: x == y,
    }
    return ops[op](a, b)


def _rows(names: list[str]) -> list[dict[str, bool]]:
    return [dict(zip(names, vals, strict=True)) for vals in itertools.product([True, False], repeat=len(names))]


def _fmt(env: dict[str, bool]) -> str:
    return ", ".join(f"{k}={'V' if v else 'F'}" for k, v in env.items())


def _check_vars(names: set[str]) -> list[str]:
    if len(names) > MAX_VARS:
        raise ValueError(f"máximo {MAX_VARS} variables proposicionales")
    return sorted(names)


def evaluate(text: str) -> str:
    if "|-" in _tokenize(text) or "⊢" in text:
        left, right = re.split(r"\|-|⊢", text, maxsplit=1)
        premises = [_Parser(_tokenize(p)).parse() for p in left.split(",") if p.strip()]
        conclusion = _Parser(_tokenize(right)).parse()
        names: set[str] = set()
        for node in [*premises, conclusion]:
            _vars(node, names)
        counter = [
            r
            for r in _rows(_check_vars(names))
            if all(_eval(p, r) for p in premises) and not _eval(conclusion, r)
        ]
        if not counter:
            return "Argumento VÁLIDO: no existe valuación con premisas verdaderas y conclusión falsa."
        return "Argumento INVÁLIDO. Contraejemplo: " + _fmt(counter[0])
    node = _Parser(_tokenize(text)).parse()
    names = set()
    _vars(node, names)
    ordered = _check_vars(names)
    table = [(r, _eval(node, r)) for r in _rows(ordered)]
    values = [v for _, v in table]
    kind = "tautología" if all(values) else "contradicción" if not any(values) else "contingente"
    shown = "\n".join(f"{_fmt(r)} => {'V' if v else 'F'}" for r, v in table[:16])
    return f"{shown}\nClasificación: {kind} ({sum(values)}/{len(values)} valuaciones verdaderas)"


class FormalLogicCalculator:
    name = "formal_logic_calculator"
    description = (
        "Evalúa lógica proposicional. Entrada: una fórmula ('P -> Q') para su tabla de verdad, "
        "o un argumento 'premisa1, premisa2 |- conclusión' para validarlo. "
        "Operadores: & | ~ -> <-> y paréntesis."
    )

    async def run(self, tool_input: str) -> str:
        try:
            return evaluate(tool_input)
        except ValueError as exc:
            return f"Sintaxis inválida: {exc}"
