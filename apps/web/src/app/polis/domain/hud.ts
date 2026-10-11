import type { AgentStep, SessionStatus, Turn } from '../../research/domain/chat.ts';
import type { CitizenState } from './citizen-state.ts';
import { WORLD_SCALE } from './city-layout.ts';
import { type DeliberationDraft, HUMAN, clock } from './deliberation.ts';

/** HUD de la Polis (ADR-013, subfase 5a): funciones puras que alimentan los componentes de la capa 4. */

// Tribuna: presets ---------------------------------------------------------------------------

export type Preset = 'quick' | 'seminar' | 'assembly';

export interface PresetInfo { id: Preset; title: string; summary: string; }

export const PRESETS: PresetInfo[] = [
  { id: 'quick', title: 'Debate rápido', summary: 'Una ronda, sin pausas' },
  { id: 'seminar', title: 'Seminario paso a paso', summary: 'Dos rondas; tú das la palabra' },
  { id: 'assembly', title: 'Asamblea abierta', summary: 'Sin rondas fijas; la cierras tú (máx. 15 min)' },
];

const PRESET_VALUES: Record<Preset, Omit<DeliberationDraft, 'participants'>> = {
  quick: { rounds: 1, openEnded: false, budgetMin: null, pace: 'auto', turnDelayS: 0, replyMin: 4 }, // = defaultDraft
  seminar: { rounds: 2, openEnded: false, budgetMin: null, pace: 'step', turnDelayS: 0, replyMin: 4 },
  assembly: { rounds: 1, openEnded: true, budgetMin: 15, pace: 'auto', turnDelayS: 5, replyMin: 4 },
};

/** Aplica un preset sin tocar a los participantes elegidos. */
export function applyPreset(draft: DeliberationDraft, preset: Preset): DeliberationDraft {
  return { ...draft, ...PRESET_VALUES[preset] };
}

/** Preset que coincide con el borrador, o null si el usuario lo personalizó. */
export function presetOf(draft: DeliberationDraft): Preset | null {
  const keys = Object.keys(PRESET_VALUES.quick) as (keyof typeof PRESET_VALUES.quick)[];
  return (Object.keys(PRESET_VALUES) as Preset[]).find((p) => keys.every((k) => PRESET_VALUES[p][k] === draft[k])) ?? null;
}

/** Preguntas de ejemplo para no empezar con la página en blanco. */
export const SUGGESTIONS = [
  '¿Qué permanece cuando todo cambia?',
  '¿Puede la ciencia decir algo sobre lo que debemos hacer?',
  '¿Es el placer el fin de una vida buena?',
];

// Barra de turno ------------------------------------------------------------------------------

/** A falta de este margen la cuenta atrás cambia de color. */
export const URGENT_S = 30;

export interface Countdown { text: string; fraction: number; urgent: boolean; }

/** Anillo de cuenta atrás: fracción restante en [0, 1] sobre el plazo total del turno. */
export function countdown(left: number | null, total: number | null): Countdown | null {
  if (left === null) return null;
  const span = Math.max(total ?? left, left, 1);
  return { text: clock(left), fraction: Math.min(1, Math.max(0, left / span)), urgent: left <= URGENT_S };
}

export interface ProgressInput {
  round?: number;
  maxRounds?: number | null;
  openEnded?: boolean;
  next?: string;
  /** Segundos que quedan del presupuesto de tiempo de la sesión, si lo tiene. */
  budgetLeft?: number | null;
}

/** «Ronda 2 de 3 · siguiente: Heráclito · quedan 4:10». `round` llega 0-based desde el grafo. */
export function progressLine(p: ProgressInput, label: (agent: string) => string): string {
  const parts: string[] = [];
  if (p.round !== undefined) {
    const n = p.round + 1;
    parts.push(p.openEnded ? `Ronda ${n} · debate abierto` : p.maxRounds ? `Ronda ${Math.min(n, p.maxRounds)} de ${p.maxRounds}` : `Ronda ${n}`);
  }
  if (p.next) parts.push(`siguiente: ${label(p.next)}`);
  if (p.budgetLeft !== null && p.budgetLeft !== undefined) parts.push(`quedan ${clock(Math.max(0, Math.round(p.budgetLeft)))}`);
  return parts.join(' · ');
}

// Crónica -------------------------------------------------------------------------------------

export type ChronicleEntry =
  | { kind: 'turn'; agent: string; round: number; text: string; respondsTo: string | null; degraded: boolean; tools: string[] }
  | { kind: 'synthesis'; text: string };

/**
 * Crónica completa: cada turno íntegro con a quién responde y las herramientas que consultó ese agente en esa
 * ronda; al final, la síntesis de Ápeiron. El `Thought` nunca llega aquí (no viaja por el SSE).
 */
export function chronicle(turns: Turn[], steps: AgentStep[], answer: string): ChronicleEntry[] {
  const entries: ChronicleEntry[] = turns.map((t) => ({
    kind: 'turn',
    agent: t.agent,
    round: t.round,
    text: t.text,
    respondsTo: t.responds_to && t.responds_to !== t.agent ? t.responds_to : null,
    degraded: !!t.degraded,
    tools: [...new Set(steps.filter((s) => s.agent === t.agent && s.round === t.round).map((s) => s.tool))],
  }));
  if (answer) entries.push({ kind: 'synthesis', text: answer });
  return entries;
}

/** Anuncio breve para `aria-live`: solo lo último, no la crónica entera. */
export function announcement(entry: ChronicleEntry | undefined, label: (agent: string) => string): string {
  if (!entry) return '';
  if (entry.kind === 'synthesis') return 'Ápeiron ha sintetizado la deliberación.';
  const who = entry.agent === HUMAN ? 'Has hablado' : `${label(entry.agent)} ha hablado`;
  return entry.respondsTo ? `${who}, en respuesta a ${label(entry.respondsTo)}.` : `${who}.`;
}

// Dock de ciudadanos --------------------------------------------------------------------------

export interface RosterEntry { name: string; state: CitizenState; inAgora: boolean; next: boolean; }

/** Quién vive en la ciudad, qué hace y si delibera ahora en el ágora. */
export function roster(
  agents: string[], states: Record<string, CitizenState>, agora: string[], next: string | null | undefined,
): RosterEntry[] {
  const present = new Set(agora);
  return agents.map((name) => ({ name, state: states[name] ?? 'idle', inAgora: present.has(name), next: name === next }));
}

// Mundo: rótulos y minimapa -------------------------------------------------------------------

export const LABEL_NEAR = 22 * WORLD_SCALE;
export const LABEL_FAR = 62 * WORLD_SCALE;

/** Opacidad de un rótulo de lugar: nítido cerca, se desvanece con la distancia y desaparece lejos. */
export function labelOpacity(distance: number, emphasis: boolean): number {
  if (emphasis) return 1;
  if (distance <= LABEL_NEAR) return 0.9;
  if (distance >= LABEL_FAR) return 0;
  return Math.round(0.9 * (1 - (distance - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR)) * 100) / 100;
}

/**
 * Rumbo del minimapa en grados (sentido horario, 0 = arriba) para una cámara con guiñada `yaw`. El motor avanza
 * hacia (-sin yaw, -cos yaw) en (x, z), y el minimapa dibuja x a la derecha y z hacia abajo.
 */
export function headingDeg(yaw: number): number {
  const deg = (-yaw * 180) / Math.PI;
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

/** Posición de ssanax que el motor envía a Angular (≤ 10 Hz, ADR-013 §5.7). */
export interface Whereabouts { x: number; z: number; heading: number; }

/** ¿Merece la pena avisar a Angular? Evita escribir signals si ssanax no se ha movido. */
export function moved(a: Whereabouts | null, b: Whereabouts): boolean {
  return !a || Math.hypot(a.x - b.x, a.z - b.z) > 0.05 || Math.abs(a.heading - b.heading) > 0.5;
}

// Onboarding ----------------------------------------------------------------------------------

export interface ControlHint { keys: string; action: string; }

/** Controles que se enseñan en la primera visita, según el dispositivo. */
export function controlHints(coarse: boolean): ControlHint[] {
  return coarse
    ? [
      { keys: 'Joystick', action: 'caminar' },
      { keys: 'Arrastrar', action: 'mirar alrededor' },
      { keys: 'Tocar un lugar', action: 'interactuar' },
      { keys: 'Mapa', action: 'ver la ciudad y viajar' },
      { keys: 'Saltar · Saludar', action: 'botones junto al mapa' },
    ]
    : [
      { keys: 'WASD / flechas', action: 'caminar (Shift: correr)' },
      { keys: 'Arrastrar · rueda', action: 'mirar y acercar' },
      { keys: 'E', action: 'interactuar' },
      { keys: 'M', action: 'mapa' },
      { keys: 'Espacio', action: 'saltar' },
      { keys: '1 – 5', action: 'gestos: saludar, encogerse, señalar, convocar, asentir' },
    ];
}

export const ONBOARDING_KEY = 'apeiron-polis-onboarded';

// Conexión y sesiones abiertas ----------------------------------------------------------------

/** Estado del enlace SSE con la sesión: el adaptador lo informa al reengancharse. */
export type LinkStatus = { kind: 'online' } | { kind: 'retrying'; attempt: number; max: number } | { kind: 'lost' };

export function linkLabel(link: LinkStatus): string | null {
  if (link.kind === 'retrying') return `Reconectando… intento ${link.attempt}/${link.max}`;
  if (link.kind === 'lost') return 'Se perdió la conexión con la sesión';
  return null;
}

/** Fila de `GET /v1/sessions`. */
export interface OpenSession {
  id: string;
  status: SessionStatus;
  question: string;
  created_at: number;
  dormant?: boolean;
  participants?: string[];
}

const FINISHED = new Set<SessionStatus>(['completed', 'cancelled', 'error']);

/** Sesión que se ofrece reanudar al entrar: la más reciente que siga abierta. */
export function resumable(sessions: OpenSession[]): OpenSession | null {
  return [...sessions].filter((s) => !FINISHED.has(s.status)).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}
