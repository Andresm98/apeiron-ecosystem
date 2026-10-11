import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { excerpt } from '../../../research/domain/dialogue';
import { OpenSession } from '../../domain/hud';

/** Aviso de sesión abierta al entrar (ADR-013 §5.6): las sesiones sobreviven a un reinicio y se pueden retomar. */
@Component({
  selector: 'app-polis-resume-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="banner" role="status">
      <p>
        <strong>Tienes una deliberación abierta</strong>
        <span>«{{ short(offer().question) }}»{{ offer().dormant ? ' · en pausa tras un reinicio' : '' }}</span>
      </p>
      <div class="actions">
        <button type="button" class="primary" (click)="resume.emit(offer().id)">Reanudar</button>
        <button type="button" (click)="dismiss.emit()">Ahora no</button>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }

    .banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 16px;
      padding: 10px 14px;
      border: 2px solid var(--hud-gold);
      border-radius: 4px;
      background: var(--hud-bg-strong);
      color: var(--hud-ink);
      font-size: 14px;
      box-shadow: var(--hud-shadow);
    }

    p { display: grid; flex: 1; gap: 2px; min-width: 200px; margin: 0; }
    span { color: var(--hud-muted); font-size: 13px; }

    .actions { display: flex; gap: 8px; }

    button {
      min-height: 38px;
      padding: 6px 14px;
      border: 0;
      border-radius: 4px;
      background: var(--hud-quiet);
      color: var(--hud-accent);
      font: 600 14px var(--font-text);
      cursor: pointer;
    }

    .primary { background: var(--hud-accent); color: var(--hud-on-accent); }
    button:focus-visible { outline: 2px solid var(--hud-focus); outline-offset: 2px; }
  `,
})
export class PolisResumeBannerComponent {
  readonly offer = input.required<OpenSession>();
  readonly resume = output<string>();
  readonly dismiss = output<void>();

  short(text: string): string {
    return excerpt(text, 90);
  }
}
