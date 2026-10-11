/**
 * Piezas glTF de la Polis: modelos que se colocan dentro de un lugar procedural (o en el cielo) sin sustituir la
 * isla, a diferencia de los landmarks (ADR-013 §5.5). El motor decide dónde va cada una y la ajusta a su hueco; el
 * asset solo aporta la forma, con el suelo en y = 0 y el frente hacia +Z.
 */
export const PROPS = {
  /** Templo de cada santuario de agente (sustituye al peristilo procedural). */
  temple: 'Templo de los santuarios',
  /** Monumento central del ágora (sustituye a la bema procedural). */
  serpent: 'Serpiente del ágora',
  /** Astro del cielo, sobre el ágora vista desde la casa de ssanax. */
  black_hole: 'Agujero negro',
} as const;

export type PropName = keyof typeof PROPS;

/**
 * Distancias (m) de cambio de nivel de detalle de una pieza con nodos `<base>_lod0/1/2` (la convención de los
 * landmarks). Más largas que las de los landmarks: las piezas son grandes y se ven de lejos (un templo desde el ágora).
 */
export const PROP_LOD_DISTANCES = [0, 60, 120] as const;

export function isPropName(name: string): name is PropName {
  return Object.hasOwn(PROPS, name);
}

/** Piezas publicadas en `props/manifest.json` que el motor conoce; el resto se ignora. */
export function publishedProps(manifest: unknown): PropName[] {
  const list = (manifest as { props?: unknown } | null)?.props;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p): p is string => typeof p === 'string').filter(isPropName))];
}

/**
 * Problemas de una pieza según los `extras` de su escena: `{"apeiron": {"prop": "<nombre>", "version": 1}}`.
 * Una pieza con problemas no se usa: el lugar conserva su versión procedural.
 */
export function propProblems(extras: Record<string, unknown>, expected: PropName): string[] {
  const apeiron = extras['apeiron'] as { prop?: unknown; version?: unknown } | undefined;
  if (!apeiron || typeof apeiron !== 'object') return ['faltan los extras «apeiron» de la escena'];
  const problems: string[] = [];
  if (apeiron.prop !== expected) problems.push(`la pieza dice ser «${String(apeiron.prop)}» y se pidió «${expected}»`);
  if (apeiron.version !== 1) problems.push(`versión no soportada: ${String(apeiron.version)}`);
  return problems;
}
