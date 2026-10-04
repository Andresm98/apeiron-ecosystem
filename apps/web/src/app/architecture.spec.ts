import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regla de dependencias (Clean/Hexagonal): las capas internas no conocen a las externas.
 *   domain         -> nada (ni Angular ni rxjs)
 *   application    -> domain (+ rxjs para los puertos, Angular DI para stores/servicios)
 *   infrastructure -> application, domain
 *   presentation   -> application, domain
 * Los ficheros `<contexto>.routes.ts` y `app.*` son la raíz de composición.
 */
const ROOT = dirname(fileURLToPath(import.meta.url));
const LAYERS = ['domain', 'application', 'infrastructure', 'presentation'] as const;
type Layer = (typeof LAYERS)[number];

const FORBIDDEN: Record<Layer, Layer[]> = {
  domain: ['application', 'infrastructure', 'presentation'],
  application: ['infrastructure', 'presentation'],
  infrastructure: ['presentation'],
  presentation: ['infrastructure'],
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function layerOf(path: string): Layer | undefined {
  return relative(ROOT, path).split(sep).find((part): part is Layer => (LAYERS as readonly string[]).includes(part));
}

function imports(path: string): string[] {
  const code = readFileSync(path, 'utf8');
  return [...code.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]!);
}

test('each layer only depends on inner layers', () => {
  const violations: string[] = [];
  for (const file of sources(ROOT)) {
    const layer = layerOf(file);
    if (!layer) continue;
    for (const spec of imports(file)) {
      const where = relative(ROOT, file);
      if (layer === 'domain' && !spec.startsWith('.')) violations.push(`${where} -> ${spec} (dominio sin frameworks)`);
      if (!spec.startsWith('.')) continue;
      const target = layerOf(resolve(dirname(file), spec));
      if (target && FORBIDDEN[layer].includes(target)) violations.push(`${where} -> ${spec}`);
    }
  }
  assert.deepEqual(violations, []);
});
