/**
 * Atmósfera de la Polis (ADR-013 §5.1–5.3, subfase 5c): «la Polis en penumbra». Funciones puras: paleta, tonos de
 * agente, contraste del HUD, niveles de calidad, regulador de fotogramas y parámetros de post-proceso. El motor
 * (Three.js + postprocessing) solo los aplica.
 */

// Paleta ------------------------------------------------------------------------------------

/**
 * La Polis cósmica: piedra ciclópea erosionada flotando en un cosmos vivo. Vacío índigo, nebulosas violeta, azul
 * medianoche y ocre, energía estelar cian y violeta en las grietas; el color saturado y cálido se reserva para lo
 * que significa algo (antorchas, el farol de ssanax, quien habla).
 */
export const PALETTE = {
  abyss: '#06070d',
  fog: '#12111f', // niebla índigo: se funde con el horizonte del cielo
  murk: '#0d0f1c', // el vacío bajo las islas
  cold: '#4a5578', // luz ambiental del cielo nocturno
  moonlight: '#9fb2e3',
  nebulaViolet: '#4b2470',
  nebulaBlue: '#11214d',
  nebulaOchre: '#7a5226',
  energy: '#7fd8ff', // grietas con flujo de energía estelar
  energyViolet: '#b48cff',
  moss: '#2c3330',
  ochre: '#6e5d42',
  stone: '#5b5850',
  stoneWet: '#3a3935',
  stoneLight: '#837c6e',
  rust: '#6a4530',
  rustGrey: '#5a514b',
  bronze: '#8a6a3a',
  wood: '#4b3826',
  cloth: '#c9c2b2', // la túnica de ssanax: la figura más clara de la escena
  lamp: '#ffb35c',
  logos: '#f2c14e',
  ok: '#9ee493',
  warn: '#f4c95d',
  danger: '#ef6461',
} as const;

interface Rgb { r: number; g: number; b: number; }

function parse(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function format({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mezcla lineal en sRGB: suficiente para tonos de material, no para física de la luz. */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  return format({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** Conserva `keep` de la saturación (0 = gris, 1 = el color original). */
export function desaturate(hex: string, keep: number): string {
  const c = parse(hex);
  const grey = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return format({ r: grey + (c.r - grey) * keep, g: grey + (c.g - grey) * keep, b: grey + (c.b - grey) * keep });
}

/** Saturación que conserva el color de un agente en reposo (ADR-013 §5.1: «desaturado al 25%»). */
export const RESTING_SATURATION = 0.25;

/**
 * Color del agente según actúe o no: en reposo, desaturado y hundido en la piedra; actuando, su color pleno (luz,
 * halo y haces). Así el ojo encuentra al que habla aunque la escena esté en penumbra.
 */
export function agentTone(hex: string, acting: boolean): string {
  return acting ? hex : mix(desaturate(hex, RESTING_SATURATION), PALETTE.stone, 0.35);
}

// Contraste del HUD (WCAG 2.1) -------------------------------------------------------------------

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const c = parse(hex);
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * Tokens del HUD (capa 4): tinta clara sobre `abyss`, reglas de 1 px. Única fuente de verdad: la página los
 * escribe como propiedades CSS (`--hud-*`) y `atmosphere.spec.ts` comprueba el contraste AA de cada par de uso.
 */
export const HUD_TOKENS = {
  'hud-bg': 'rgb(11 11 22 / 78%)',
  'hud-bg-strong': 'rgb(11 11 22 / 94%)',
  'hud-solid': '#12121d', // fondo opaco equivalente, para medir contraste
  'hud-ink': '#e6e1d3',
  'hud-muted': '#a8a192',
  'hud-accent': PALETTE.logos,
  'hud-on-accent': '#14110a',
  'hud-quiet': 'rgb(230 225 211 / 9%)',
  'hud-selected': 'rgb(242 193 78 / 10%)',
  'hud-line': 'rgb(230 225 211 / 22%)',
  'hud-field': '#08080f',
  'hud-gold': PALETTE.logos,
  'hud-warn': PALETTE.warn,
  'hud-danger': PALETTE.danger,
  'hud-focus': '#8fc7ea',
  'hud-dark': 'rgb(8 8 16 / 88%)',
  'hud-on-dark': '#e6e1d3',
  'hud-water': PALETTE.murk,
  'hud-bridge': PALETTE.rust,
  'hud-shadow': '0 10px 32px rgb(0 0 0 / 45%)',
} as const;

/** Pares texto/fondo que usa el HUD; todos deben cumplir 4,5:1. */
export const HUD_CONTRAST_PAIRS: [text: keyof typeof HUD_TOKENS, background: keyof typeof HUD_TOKENS][] = [
  ['hud-ink', 'hud-solid'],
  ['hud-muted', 'hud-solid'],
  ['hud-on-accent', 'hud-accent'],
  ['hud-gold', 'hud-solid'],
  ['hud-warn', 'hud-solid'],
  ['hud-danger', 'hud-solid'],
  ['hud-focus', 'hud-solid'],
  ['hud-ink', 'hud-field'],
];

// Calidad -------------------------------------------------------------------------------------

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY_LEVELS: Quality[] = ['low', 'medium', 'high'];

export const QUALITY_LABEL: Record<Quality, string> = { low: 'Baja', medium: 'Media', high: 'Alta' };

export function isQuality(value: unknown): value is Quality {
  return value === 'low' || value === 'medium' || value === 'high';
}

/**
 * Nivel de partida: el que fija la URL (`?quality=low`, lo usa CI), el que eligió el usuario o, si no, baja en
 * táctil y media en escritorio.
 */
export function initialQuality(opts: { coarse: boolean; forced?: string | null; chosen?: string | null }): Quality {
  if (isQuality(opts.forced)) return opts.forced;
  if (isQuality(opts.chosen)) return opts.chosen;
  return opts.coarse ? 'low' : 'medium';
}

export function lowerQuality(level: Quality): Quality | null {
  const i = QUALITY_LEVELS.indexOf(level);
  return i > 0 ? QUALITY_LEVELS[i - 1]! : null;
}

/** Si la media del fotograma supera este valor durante una ventana entera, se baja un nivel. */
export const FRAME_BUDGET_MS = 22;
export const GOVERNOR_WINDOW_MS = 3000;

/**
 * Regulador de calidad (ADR-013 §5.3): mide ventanas de 3 s y, si la media supera 22 ms, propone bajar un nivel.
 * Nunca sube solo. Determinista y sin reloj propio: el motor le pasa la duración de cada fotograma.
 */
export class QualityGovernor {
  private elapsed = 0;
  private frames = 0;
  private level: Quality;
  private readonly enabled: boolean;

  /** `enabled = false` cuando el usuario fijó el nivel a mano: se respeta su elección. */
  constructor(level: Quality, enabled = true) {
    this.level = level;
    this.enabled = enabled;
  }

  get current(): Quality {
    return this.level;
  }

  /** Devuelve el nivel nuevo si hay que bajar; null si no cambia. */
  sample(frameMs: number): Quality | null {
    if (!this.enabled || frameMs <= 0) return null;
    this.elapsed += frameMs;
    this.frames += 1;
    if (this.elapsed < GOVERNOR_WINDOW_MS) return null;
    const average = this.elapsed / this.frames;
    this.elapsed = 0;
    this.frames = 0;
    const lower = average > FRAME_BUDGET_MS ? lowerQuality(this.level) : null;
    if (lower) this.level = lower;
    return lower;
  }

  /** El usuario o la página fijaron otro nivel: la medición empieza de cero. */
  reset(level: Quality): void {
    this.level = level;
    this.elapsed = 0;
    this.frames = 0;
  }
}

// Render y post-proceso por nivel ------------------------------------------------------------

export interface RenderSettings {
  pixelRatioMax: number;
  /** Lado del mapa de sombras de la luna; 0 = sin sombras en tiempo real (quedan las de contacto). */
  shadowMapSize: number;
  /** Planos de niebla baja sobre el agua (capa 0). */
  fogPlanes: boolean;
  /** Partículas de polvo cósmico flotando alrededor de ssanax. */
  stardust: number;
  /** Ruinas, monolitos y fragmentos flotantes del horizonte (anillo exterior hasta ~500 m). */
  horizonRuins: number;
  /** Vegetación oscura y plantas bioluminiscentes por isla. */
  vegetation: number;
  /** Ondulación del agua (se calcula en CPU: en baja el agua queda quieta). */
  waterMotion: boolean;
  /** Composer de postprocessing; en baja el tone mapping lo hace el propio renderer. */
  composer: boolean;
  exposure: number;
  fogDensity: number;
  grading: { contrast: number; saturation: number; split: number } | null;
  vignette: { offset: number; darkness: number } | null;
  bloom: { intensity: number; threshold: number; smoothing: number } | null;
  dof: { focusRange: number; bokehScale: number } | null;
  grain: number | null;
}

export interface RenderContext {
  /** Hay una deliberación, un diálogo o tu turno: la escena debe leerse entera (sin DoF). */
  focusLocked: boolean;
  reducedMotion: boolean;
}

const EXPOSURE = 1; // 0,9 en el ADR original: con la paleta definitiva la penumbra no se leía
const FOG_DENSITY = 0.0036; // a escala monumental: los santuarios se recortan a 200–300 m y se funden con el cielo

/** Tabla 5.3 del ADR-013 como datos. */
export function renderSettings(level: Quality, ctx: RenderContext): RenderSettings {
  const medium = level !== 'low';
  const high = level === 'high';
  return {
    pixelRatioMax: high ? 2 : medium ? 1.5 : 1,
    shadowMapSize: high ? 2048 : medium ? 1024 : 0,
    fogPlanes: medium,
    stardust: high ? 6000 : medium ? 3500 : 1200,
    horizonRuins: high ? 160 : medium ? 110 : 50,
    vegetation: high ? 1 : medium ? 0.75 : 0.4,
    waterMotion: medium && !ctx.reducedMotion,
    composer: medium,
    exposure: EXPOSURE,
    fogDensity: FOG_DENSITY,
    grading: medium ? { contrast: 1.18, saturation: 0.78, split: 0.35 } : null,
    vignette: medium ? { offset: 0.3, darkness: 0.65 } : null,
    bloom: medium ? { intensity: 0.35, threshold: 0.85, smoothing: 0.2 } : null,
    dof: high && !ctx.focusLocked && !ctx.reducedMotion ? { focusRange: 9, bokehScale: 2 } : null,
    grain: high && !ctx.reducedMotion ? 0.04 : null,
  };
}

// Medición ------------------------------------------------------------------------------------

export interface PerfSample { fps: number; frameMs: number; calls: number; triangles: number; textures: number; quality: Quality; }

/** Comprueba una muestra contra los presupuestos de 5.7 (draw calls y triángulos). */
export function overBudget(sample: PerfSample): string[] {
  const problems: string[] = [];
  const maxCalls = sample.quality === 'low' ? 80 : 150;
  if (sample.calls >= maxCalls) problems.push(`draw calls ${sample.calls} ≥ ${maxCalls}`);
  if (sample.triangles >= 300_000) problems.push(`triángulos ${sample.triangles} ≥ 300000`);
  return problems;
}
