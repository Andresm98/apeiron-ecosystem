import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, input, output, viewChild } from '@angular/core';
import { controlHints } from '../../domain/hud';

/** Bienvenida de la primera visita (ADR-013 §5.6): qué es la Polis y los controles según el dispositivo. */
@Component({
  selector: 'app-polis-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="onboarding" role="dialog" aria-modal="false" aria-labelledby="onboarding-title">
      <p class="eyebrow">Bienvenida</p>
      <h2 id="onboarding-title">Eres {{ player() }}, ciudadano de la Polis</h2>
      <p>Cada isla es la morada de un agente. Acércate a uno para preguntarle, o ve al <strong>ágora</strong> del centro para convocar una deliberación en la que también puedes hablar.</p>
      <dl>
        @for (h of hints(); track h.keys) {
          <div><dt>{{ h.keys }}</dt><dd>{{ h.action }}</dd></div>
        }
      </dl>
      <button #start type="button" (click)="done.emit()">Empezar a caminar</button>
    </section>
  `,
  styles: `
    :host { display: block; }

    .onboarding {
      display: grid;
      gap: 10px;
      width: min(440px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 20px;
      border: 1px solid var(--hud-line);
      border-radius: 4px;
      background: var(--hud-bg-strong);
      color: var(--hud-ink);
      font-size: 14px;
      line-height: 1.5;
      box-shadow: var(--hud-shadow);
    }

    .eyebrow {
      margin: 0;
      color: var(--hud-muted);
      font: 600 11px var(--font-text);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h2 { margin: 0; font: 650 20px/1.2 var(--font-display); }
    p { margin: 0; }

    dl { display: grid; gap: 4px; margin: 0; }
    dl div { display: flex; gap: 10px; }
    dt { min-width: 128px; font: 600 12px/1.6 var(--font-mono); }
    dd { margin: 0; color: var(--hud-muted); }

    button {
      min-height: 44px;
      border: 0;
      border-radius: 4px;
      background: var(--hud-accent);
      color: var(--hud-on-accent);
      font: 650 15px var(--font-text);
      cursor: pointer;
    }

    button:focus-visible { outline: 2px solid var(--hud-focus); outline-offset: 2px; }
  `,
})
export class PolisOnboardingComponent {
  readonly player = input.required<string>();
  readonly coarse = input(false);
  readonly done = output<void>();

  readonly hints = computed(() => controlHints(this.coarse()));
  private readonly start = viewChild<ElementRef<HTMLButtonElement>>('start');

  constructor() {
    afterNextRender(() => this.start()?.nativeElement.focus({ preventScroll: true }));
  }
}
