import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Countdown } from '../../domain/hud';

export type TurnBarMode = 'turn' | 'advance' | 'watch';

const RING = 2 * Math.PI * 18;

/**
 * Barra de la deliberación (ADR-013 §5.6). En tu turno: anillo de cuenta atrás (cambia de color a falta de 30 s),
 * contador de caracteres y `Ctrl+Enter` para hablar. En ritmo paso a paso: dar la palabra. Siempre: progreso de la
 * sesión, estado de la conexión, cerrar y cancelar.
 */
@Component({
  selector: 'app-polis-turn-bar',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bar" [class.mine]="mode() === 'turn'" aria-label="Deliberación en curso">
      <div class="head">
        @if (mode() === 'turn' && countdown(); as c) {
          <svg class="ring" [class.urgent]="c.urgent" viewBox="0 0 44 44" role="img" [attr.aria-label]="'Te quedan ' + c.text">
            <circle cx="22" cy="22" r="18" class="track" />
            <circle cx="22" cy="22" r="18" class="left" [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ring * (1 - c.fraction)" />
            <text x="22" y="26">{{ c.text }}</text>
          </svg>
        }
        <div class="title">
          @switch (mode()) {
            @case ('turn') {
              <strong>Tu turno, {{ player() }}</strong>
              @if (respondsTo(); as other) { <span>Respondes a {{ other }}</span> }
            }
            @case ('advance') { <strong>Siguiente: {{ next() }}</strong><span>Tú das la palabra</span> }
            @default { <strong>{{ status() }}</strong> }
          }
          @if (progress()) { <small>{{ progress() }}</small> }
        </div>
      </div>

      @if (mode() === 'turn') {
        <textarea #reply rows="2" [(ngModel)]="text" maxlength="4000" placeholder="Lo que dirías en el ágora…"
          aria-label="Tu intervención" (keydown.control.enter)="say()" (keydown.meta.enter)="say()"></textarea>
        <p class="hint"><span>{{ text().length }}/4000</span><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> hablar</span></p>
      }

      @if (link()) { <p class="link" role="status">{{ link() }}</p> }
      @if (notice()) { <p class="notice" role="alert">{{ notice() }}</p> }

      <div class="actions">
        @if (mode() === 'turn') {
          <button type="button" class="primary" [disabled]="busy() || !text().trim()" (click)="say()">Hablar</button>
          <button type="button" [disabled]="busy()" (click)="pass.emit()">Pasar</button>
        } @else if (mode() === 'advance') {
          <button type="button" class="primary" [disabled]="busy()" (click)="advance.emit()">Dar la palabra</button>
        }
        <span class="spacer"></span>
        @if (closable()) {
          <button type="button" [disabled]="busy()" (click)="close.emit()">Cerrar y sintetizar</button>
        }
        <button type="button" (click)="cancel.emit()">Cancelar</button>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }

    .bar {
      display: grid;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--hud-line);
      border-radius: 4px;
      background: var(--hud-bg-strong);
      color: var(--hud-ink);
      font-size: 14px;
      box-shadow: var(--hud-shadow);
    }

    .mine { border: 2px solid var(--hud-gold); }

    .head { display: flex; align-items: center; gap: 12px; }

    .title { display: grid; gap: 1px; }
    .title span, small { color: var(--hud-muted); font-size: 12px; }

    .ring { flex: none; width: 52px; height: 52px; }
    .ring circle { fill: none; stroke-width: 4; }
    .ring .track { stroke: var(--hud-line); }
    .ring .left { stroke: #9ee493; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 1s linear; }
    .ring text { fill: var(--hud-ink); font: 700 10px var(--font-mono); text-anchor: middle; }
    .ring.urgent .left { stroke: var(--hud-danger); }
    .ring.urgent text { fill: var(--hud-danger); }

    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--hud-line);
      border-radius: 4px;
      background: var(--hud-field);
      color: var(--hud-ink);
      font: 400 14px var(--font-text);
      resize: vertical;
    }

    textarea:focus-visible, button:focus-visible { outline: 2px solid var(--hud-focus); outline-offset: 2px; }

    .hint { display: flex; justify-content: space-between; margin: -4px 0 0; color: var(--hud-muted); font-size: 12px; }

    kbd {
      padding: 0 5px;
      border: 1px solid var(--hud-line);
      border-bottom-width: 2px;
      border-radius: 4px;
      background: var(--hud-field);
      font: 600 11px var(--font-mono);
    }

    .link { margin: 0; color: var(--hud-warn); font-weight: 600; }
    .notice { margin: 0; color: var(--hud-danger); }

    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .spacer { flex: 1; }

    button {
      min-height: 38px;
      padding: 8px 14px;
      border: 0;
      border-radius: 4px;
      background: var(--hud-quiet);
      color: var(--hud-accent);
      font: 600 14px var(--font-text);
      cursor: pointer;

      &:disabled { opacity: 0.45; cursor: not-allowed; }
    }

    .primary { background: var(--hud-accent); color: var(--hud-on-accent); }

    @media (prefers-reduced-motion: reduce) {
      .ring .left { transition: none; }
    }
  `,
})
export class PolisTurnBarComponent {
  readonly mode = input.required<TurnBarMode>();
  readonly player = input.required<string>();
  readonly status = input('');
  readonly respondsTo = input<string | null>(null);
  readonly next = input('');
  readonly countdown = input<Countdown | null>(null);
  readonly progress = input('');
  readonly link = input<string | null>(null);
  readonly notice = input('');
  readonly busy = input(false);
  readonly closable = input(false);

  readonly speak = output<string>();
  readonly pass = output<void>();
  readonly advance = output<void>();
  readonly close = output<void>();
  readonly cancel = output<void>();

  readonly ring = RING;
  readonly text = signal('');
  private readonly reply = viewChild<ElementRef<HTMLTextAreaElement>>('reply');

  constructor() {
    // Cuando llega tu turno, el foco va al campo de texto: se puede escribir sin buscarlo.
    effect(() => {
      if (this.mode() === 'turn') queueMicrotask(() => this.reply()?.nativeElement.focus({ preventScroll: true }));
    });
  }

  say(): void {
    const text = this.text().trim();
    if (!text || this.busy()) return;
    this.speak.emit(text);
  }

  /** La página lo llama cuando la API aceptó el turno. */
  clear(): void {
    this.text.set('');
  }
}
