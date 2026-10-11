import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, linkedSignal, viewChild } from '@angular/core';
import { excerpt } from '../../../research/domain/dialogue';
import { HUMAN } from '../../domain/deliberation';
import { ChronicleEntry, announcement } from '../../domain/hud';

/**
 * Crónica de la ejecución (ADR-013 §5.6): plegada muestra el estado y la última intervención; desplegada, los
 * turnos íntegros con a quién responden, las herramientas consultadas y la síntesis. Los lectores de pantalla
 * reciben solo un anuncio breve de lo último (`aria-live`), nunca la crónica entera.
 */
@Component({
  selector: 'app-polis-chronicle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="chronicle" aria-label="Crónica">
      <header>
        <p class="core" [attr.data-core]="core()"><span class="dot" aria-hidden="true"></span>{{ status() }}</p>
        <button type="button" class="toggle" (click)="open.set(!open())" [attr.aria-expanded]="open() && entries().length > 0"
          [disabled]="!entries().length">
          {{ open() && entries().length ? 'Plegar' : 'Crónica' }}@if (!open() && entries().length) { · {{ entries().length }} }
        </button>
      </header>
      @if (problem(); as p) { <p class="problem" role="alert">{{ p }}</p> }

      @if (open() && entries().length) {
        <ol class="entries" #list>
          @for (e of entries(); track $index) {
            @if (e.kind === 'turn') {
              <li [class.self]="e.agent === human" [class.degraded]="e.degraded">
                <p class="meta">
                  <strong>{{ label()(e.agent) }}</strong>
                  @if (e.respondsTo) { <span>→ {{ label()(e.respondsTo) }}</span> }
                  <span class="round">ronda {{ e.round + 1 }}</span>
                  @if (e.degraded) { <span class="flag">degradado</span> }
                </p>
                <p class="text">{{ e.text }}</p>
                @if (e.tools.length) { <p class="tools">Consultó: {{ e.tools.join(' · ') }}</p> }
              </li>
            } @else {
              <li class="synthesis">
                <p class="meta"><strong>Síntesis de Ápeiron</strong></p>
                <p class="text">{{ e.text }}</p>
              </li>
            }
          }
        </ol>
      } @else if (last(); as e) {
        <p class="last">
          @if (e.kind === 'turn') {
            <strong>{{ label()(e.agent) }}</strong>
            @if (e.respondsTo) { <span class="reply">→ {{ label()(e.respondsTo) }}</span> }
            {{ short(e.text) }}
          } @else {
            <strong>Síntesis</strong> {{ short(e.text) }}
          }
        </p>
      }
      <p class="sr-only" aria-live="polite">{{ spoken() }}</p>
    </section>
  `,
  styles: `
    :host { display: block; }

    .chronicle {
      display: grid;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 4px;
      background: var(--hud-dark);
      color: var(--hud-on-dark);
      font-size: 13px;
      line-height: 1.45;
      backdrop-filter: blur(8px);
      box-shadow: var(--hud-shadow);
    }

    header { display: flex; align-items: center; gap: 8px; }

    .core { display: flex; flex: 1; align-items: center; gap: 8px; margin: 0; font-weight: 600; }

    .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--hud-gold); }

    [data-core='routing'] .dot,
    [data-core='supervising'] .dot,
    [data-core='synthesizing'] .dot,
    [data-core='turn'] .dot { background: #ffd166; animation: breathe 1s ease-in-out infinite; }
    [data-core='done'] .dot { background: #9ee493; }
    [data-core='error'] .dot { background: #ef6461; }

    @keyframes breathe { 50% { opacity: 0.4; } }

    .toggle {
      min-height: 32px;
      padding: 4px 10px;
      border: 1px solid rgb(255 255 255 / 35%);
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: 600 12px var(--font-text);
      cursor: pointer;

      &:disabled { opacity: 0.5; cursor: default; }
      &:focus-visible { outline: 2px solid #ffd166; outline-offset: 2px; }
    }

    .problem { margin: 0; color: #ffc9c5; }

    .last { margin: 0; }

    .reply, .meta span { color: #ffe8a3; }

    .entries {
      display: grid;
      gap: 10px;
      max-height: var(--chronicle-max, 46vh);
      margin: 0;
      padding: 0 4px 0 0;
      overflow: auto;
      list-style: none;
    }

    li { padding-left: 10px; border-left: 2px solid rgb(255 255 255 / 25%); }
    li.self { border-left-color: #ffd166; }
    li.degraded { border-left-color: #f4a259; }
    li.synthesis { border-left-color: #9ee493; }

    .meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
    .meta .round { color: rgb(242 239 230 / 70%); }
    .meta .flag { color: #ffcf9e; }

    .text { margin: 2px 0 0; white-space: pre-wrap; }

    .tools { margin: 2px 0 0; color: #a8e4ff; font-size: 12px; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    @media (prefers-reduced-motion: reduce) {
      .dot { animation: none !important; }
    }
  `,
})
export class PolisChronicleComponent {
  readonly entries = input.required<ChronicleEntry[]>();
  readonly status = input.required<string>();
  readonly core = input<string>('idle');
  /** Fallo o conexión perdida: se muestra siempre, también plegada. */
  readonly problem = input<string | null>(null);
  readonly label = input.required<(agent: string) => string>();
  /** Abierta por defecto en escritorio; en táctil empieza plegada. */
  readonly startOpen = input(true);

  readonly human = HUMAN;
  readonly open = linkedSignal(() => this.startOpen()); // solo cambia si cambia el dispositivo, no con cada turno
  readonly last = computed(() => this.entries().at(-1));
  readonly spoken = computed(() => announcement(this.last(), this.label()));
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Al llegar una intervención nueva, la crónica abierta baja hasta ella.
    effect(() => {
      this.entries();
      const el = this.list()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight }));
    });
  }

  short(text: string): string {
    return excerpt(text, 140);
  }
}
