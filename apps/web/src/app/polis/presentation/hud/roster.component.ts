import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CitizenState } from '../../domain/citizen-state';
import { RosterEntry } from '../../domain/hud';

const STATE_SHORT: Record<CitizenState, string> = {
  idle: 'en su lugar', working: 'razonando', using_tool: 'consultando',
  done: 'ha hablado', degraded: 'degradado', error: 'error',
};

/** Dock de ciudadanos (ADR-013 §5.6): quién vive en la ciudad, qué hace y dónde está. Un clic lleva a su lugar. */
@Component({
  selector: 'app-polis-roster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="roster" aria-label="Ciudadanos">
      @for (c of entries(); track c.name) {
        <li>
          <button type="button" class="citizen" [attr.data-state]="c.state" [style.--tone]="color()(c.name)"
            (click)="go.emit(c.name)"
            [attr.aria-label]="label()(c.name) + ', ' + short[c.state] + (c.inAgora ? ', en el ágora' : '') + (c.next ? ', habla después' : '') + '. Ir a su lugar'">
            <span class="avatar" aria-hidden="true">{{ initial(c.name) }}</span>
            <span class="text">
              <strong>{{ label()(c.name) }}</strong>
              <small>{{ c.next ? 'siguiente' : short[c.state] }}{{ c.inAgora ? ' · ágora' : '' }}</small>
            </span>
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: block; }

    .roster {
      display: flex;
      flex-direction: var(--roster-direction, column);
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .citizen {
      --tone: #999;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 40px;
      padding: 4px 10px 4px 4px;
      border: 1px solid var(--hud-line);
      border-radius: 4px;
      background: var(--hud-bg);
      color: var(--hud-ink);
      font: 400 12px/1.15 var(--font-text);
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: var(--hud-shadow);
    }

    .citizen:focus-visible { outline: 2px solid var(--hud-focus); outline-offset: 2px; }

    .avatar {
      display: grid;
      place-items: center;
      flex: none;
      width: 30px;
      height: 30px;
      border: 3px solid transparent;
      border-radius: 50%;
      background: var(--tone);
      color: #fff;
      font: 700 13px var(--font-display);
      text-shadow: 0 1px 2px rgb(0 0 0 / 50%);
    }

    .text { display: grid; }

    small { color: var(--hud-muted); font-size: 11px; }

    [data-state='working'] .avatar,
    [data-state='using_tool'] .avatar {
      border-color: var(--hud-gold);
      animation: pulse 1s ease-in-out infinite;
    }

    [data-state='using_tool'] .avatar { border-color: #4aa8d8; }
    [data-state='done'] .avatar { border-color: #5aa469; }
    [data-state='degraded'] .avatar { border-color: #d98a3d; }
    [data-state='error'] .avatar { border-color: var(--hud-danger); }

    @keyframes pulse { 50% { transform: scale(0.92); } }

    @media (prefers-reduced-motion: reduce) {
      .avatar { animation: none !important; }
    }
  `,
})
export class PolisRosterComponent {
  readonly entries = input.required<RosterEntry[]>();
  readonly label = input.required<(agent: string) => string>();
  readonly color = input.required<(agent: string) => string>();
  readonly go = output<string>();

  readonly short = STATE_SHORT;

  initial(agent: string): string {
    return this.label()(agent).charAt(0).toUpperCase();
  }
}
