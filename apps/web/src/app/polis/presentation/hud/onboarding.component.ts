import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, input, output, viewChild } from '@angular/core';
import type { FigureInfo } from '../../domain/figure-catalog';
import { controlHints } from '../../domain/hud';

/** Atribución de los modelos publicados: la exigen CC BY y CC BY-NC; el templo (Sketchfab Standard), por cortesía. */
const CREDITS = [
  {
    what: 'Estatua de los ciudadanos', title: 'Asklepios', author: 'noe-3d.at', license: 'CC BY-NC 4.0',
    url: 'https://sketchfab.com/3d-models/asklepios-3e87e2d771164cac96d4d3b12cec9e36',
  },
  {
    what: 'Templo de los santuarios', title: 'Greek Temple Scan', author: 'golukumar', license: 'Sketchfab Standard',
    url: 'https://sketchfab.com/3d-models/greek-temple-scan-153f834227ba47f48fe7b85ed9899082',
  },
  {
    what: 'Serpiente del ágora', title: 'Snake Statue', author: 'Ville Seppänen', license: 'CC BY 4.0',
    url: 'https://sketchfab.com/3d-models/snake-statue-794b77a3e4654a669cf259d20dc89ec7',
  },
  {
    what: 'Agujero negro', title: 'Black Hole', author: 'NestaEric', license: 'CC BY 4.0',
    url: 'https://sketchfab.com/3d-models/black-hole-e410da98b1e5445eae2acafaaa53587d',
  },
] as const;

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
      @if (figures().length > 1) {
        <fieldset class="looks">
          <legend>Tu aspecto</legend>
          @for (f of figures(); track f.id) {
            <button type="button" class="look" [class.on]="f.id === figure()" [attr.aria-pressed]="f.id === figure()" (click)="choose.emit(f.id)">{{ f.title }}</button>
          }
        </fieldset>
      }
      <button #start type="button" (click)="done.emit()">Empezar a caminar</button>
      <p class="credits">
        @for (c of credits; track c.url) {
          {{ c.what }}: <a [href]="c.url" target="_blank" rel="noopener noreferrer">«{{ c.title }}»</a>, de {{ c.author }} ({{ c.license }}).
        }
      </p>
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

    .looks { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; border: 0; }
    .looks legend { margin-bottom: 6px; padding: 0; color: var(--hud-muted); font: 600 11px var(--font-text); letter-spacing: 0.08em; text-transform: uppercase; }
    .look {
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--hud-line);
      background: transparent;
      color: var(--hud-ink);
      font: 600 13px var(--font-text);
    }
    .look.on { border-color: var(--hud-accent); background: var(--hud-accent); color: var(--hud-on-accent); }

    .credits { color: var(--hud-muted); font-size: 11px; }
    .credits a { color: inherit; }
  `,
})
export class PolisOnboardingComponent {
  readonly player = input.required<string>();
  readonly coarse = input(false);
  /** Aspectos que puede llevar ssanax (personajes animados del catálogo) y el que lleva ahora. */
  readonly figures = input<FigureInfo[]>([]);
  readonly figure = input<string | null>(null);
  readonly done = output<void>();
  readonly choose = output<string>();

  readonly hints = computed(() => controlHints(this.coarse()));
  readonly credits = CREDITS;
  private readonly start = viewChild<ElementRef<HTMLButtonElement>>('start');

  constructor() {
    afterNextRender(() => this.start()?.nativeElement.focus({ preventScroll: true }));
  }
}
