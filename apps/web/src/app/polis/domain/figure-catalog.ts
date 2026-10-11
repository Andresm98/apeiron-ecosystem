/**
 * Catálogo de figuras de la Polis (ADR-013): los aspectos publicados en `characters/manifest.json` y quién lleva
 * cuál. Cada agente declara su figura en su manifiesto (`[residence] figure`); el jugador elige la suya. Una figura
 * que no existe no rompe nada: se usa la de su clase.
 */

/** `rigged`: personaje con esqueleto y clips (camina, corre, salta). `statue`: estatua viva (levita y se ilumina). */
export type FigureKind = 'rigged' | 'statue';

export interface FigureInfo {
  id: string;
  kind: FigureKind;
  /** Nombre visible en el selector de aspecto. */
  title: string;
}

/** Aspecto por defecto de ssanax y de los agentes que no declaran figura (si están publicados). */
export const DEFAULT_PLAYER_FIGURE = 'ssanax';
export const DEFAULT_CITIZEN_FIGURE = 'philosopher';

const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
/** Manifiesto v1 (solo identificadores): el tipo sale del nombre. */
const LEGACY: Record<string, FigureInfo> = {
  ssanax: { id: 'ssanax', kind: 'rigged', title: 'ssanax' },
  philosopher: { id: 'philosopher', kind: 'statue', title: 'Estatua de mármol' },
};

/** Figuras publicadas, válidas y sin repetir. Acepta `{id, kind, title}` (v2) o identificadores sueltos (v1). */
export function parseFigures(manifest: unknown): FigureInfo[] {
  const list = (manifest as { characters?: unknown } | null)?.characters;
  if (!Array.isArray(list)) return [];
  const figures = new Map<string, FigureInfo>();
  for (const entry of list) {
    const figure = typeof entry === 'string' ? (LEGACY[entry] ?? { id: entry, kind: 'rigged' as const, title: entry }) : entry as Partial<FigureInfo>;
    if (typeof figure.id !== 'string' || !ID_RE.test(figure.id) || figures.has(figure.id)) continue;
    if (figure.kind !== 'rigged' && figure.kind !== 'statue') continue;
    figures.set(figure.id, { id: figure.id, kind: figure.kind, title: typeof figure.title === 'string' && figure.title.trim() ? figure.title.trim() : figure.id });
  }
  return [...figures.values()];
}

/** Aspectos que puede llevar ssanax: los personajes animados (camina y corre con sus clips). */
export function playerFigures(catalog: FigureInfo[]): FigureInfo[] {
  return catalog.filter((f) => f.kind === 'rigged');
}

/** Figura de ssanax: la elegida si sigue publicada; si no, la de por defecto o el primer personaje animado. */
export function playerFigure(catalog: FigureInfo[], chosen?: string | null): FigureInfo | null {
  const options = playerFigures(catalog);
  return options.find((f) => f.id === chosen) ?? options.find((f) => f.id === DEFAULT_PLAYER_FIGURE) ?? options[0] ?? null;
}

/**
 * Figura de un agente: la que declara su manifiesto si está publicada; si no, la estatua por defecto. `null` = la
 * figura procedural (el cono), que sirve sin ningún asset.
 */
export function citizenFigure(catalog: FigureInfo[], declared?: string): FigureInfo | null {
  return catalog.find((f) => f.id === declared) ?? catalog.find((f) => f.id === DEFAULT_CITIZEN_FIGURE) ?? null;
}
