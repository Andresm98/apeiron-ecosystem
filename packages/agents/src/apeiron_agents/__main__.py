"""CLI del catálogo de agentes.

    python -m apeiron_agents list                         # agentes cargados y su acceso
    python -m apeiron_agents migration [--write DIR]      # migración Supabase que alinea public.agents

La migración se genera, nunca se escribe a mano: así el catálogo SQL no puede divergir de los manifiestos
(lo comprueba `test_catalog.py`). Aplicarla en remoto sigue exigiendo `npx supabase db push` con confirmación.
"""

import argparse
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from apeiron_agents.catalog import catalog_digest, catalog_rows, load_catalog

DIGEST_MARK = "-- apeiron-agents-catalog:"
_TOOL_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def _quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def migration_sql() -> str:
    specs = load_catalog()
    rows = catalog_rows(specs)
    values = []
    for row in rows:
        if not all(_TOOL_RE.match(t) for t in row["tools"]):
            raise ValueError(f"nombre de tool inválido en {row['id']!r}")
        tools = "'{" + ",".join(row["tools"]) + "}'"
        values.append(
            f"  ({_quote(row['id'])}, {_quote(row['display_name'])}, 'worker',\n"
            f"   {_quote(row['role'])},\n   {tools})"
        )
    ids = ", ".join(_quote(row["id"]) for row in rows)
    return (
        "-- Ápeiron: catálogo de agentes generado desde los manifiestos (ADR-013). NO editar a mano:\n"
        "--   python -m apeiron_agents migration --write supabase/migrations\n"
        "-- Se aplica con la CLI (`supabase db push`). Es idempotente.\n"
        f"{DIGEST_MARK} {catalog_digest(specs)}\n\n"
        "insert into public.agents (id, display_name, kind, role, tools, active) values\n"
        + ",\n".join(v[:-1] + ", true)" for v in values)
        + "\non conflict (id) do update set\n"
        "  display_name = excluded.display_name,\n"
        "  kind         = excluded.kind,\n"
        "  role         = excluded.role,\n"
        "  tools        = excluded.tools,\n"
        "  active       = true,\n"
        "  updated_at   = now();\n\n"
        "-- Un worker que ya no tiene carpeta queda inactivo: sus ejecuciones pasadas conservan la referencia.\n"
        "update public.agents set active = false, updated_at = now()\n"
        f"where kind = 'worker' and active and id not in ({ids});\n"
    )


def _next_version(folder: Path) -> str:
    """Versión posterior a la última migración existente: la CLI de Supabase las aplica en orden."""
    now = int(f"{datetime.now(UTC):%Y%m%d%H%M%S}")
    versions = [int(m.group(1)) for f in folder.glob("*.sql") if (m := re.match(r"^(\d{14})_", f.name))]
    return str(max([now, *(v + 1 for v in versions)]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="apeiron_agents")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    mig = sub.add_parser("migration")
    mig.add_argument("--write", metavar="DIR", help="escribe <timestamp>_agents_catalog.sql en DIR")
    args = parser.parse_args(argv)
    if args.command == "list":
        for spec in load_catalog():
            flags = " ".join(f for f, on in (("debate", spec.debate), ("a2a", spec.a2a)) if on)
            print(f"{spec.name:<14} {spec.display_name:<14} tools={','.join(spec.tools) or '-'} {flags}")
        return 0
    sql = migration_sql()
    if not args.write:
        sys.stdout.write(sql)
        return 0
    target = Path(args.write) / f"{_next_version(Path(args.write))}_agents_catalog.sql"
    target.write_text(sql, encoding="utf-8")
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
