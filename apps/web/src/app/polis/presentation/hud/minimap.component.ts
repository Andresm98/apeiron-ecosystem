import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AGORA_ID, BRIDGE_WIDTH, Place } from '../../domain/city-layout';
import { Whereabouts } from '../../domain/hud';

/** Minimapa permanente (ADR-013 §5.6): lugares, puentes, «estás aquí» y rumbo. Un clic abre el mapa completo. */
@Component({
  selector: 'app-polis-minimap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="minimap" (click)="expand.emit()" [attr.aria-label]="'Abrir el mapa · ' + hereText()">
      <svg [attr.viewBox]="box()" aria-hidden="true">
        @for (place of places(); track place.id) {
          @if (place.id !== agoraId) {
            <line x1="0" y1="0" [attr.x2]="place.x" [attr.y2]="place.z" class="bridge" [attr.stroke-width]="bridgeWidth" />
          }
        }
        @for (place of places(); track place.id) {
          <circle [attr.cx]="place.x" [attr.cy]="place.z" [attr.r]="place.radius" [attr.fill]="place.color"
            [class.near]="place.id === near()" />
        }
        @if (where(); as w) {
          <g [attr.transform]="'translate(' + w.x + ' ' + w.z + ') rotate(' + w.heading + ')'" class="me">
            <path d="M0 -7 L5 5 L0 2.5 L-5 5 Z" />
          </g>
        }
      </svg>
      <span class="here">{{ hereText() }}</span>
    </button>
  `,
  styles: `
    :host { display: block; }

    .minimap {
      display: grid;
      gap: 4px;
      width: var(--minimap-size, 168px);
      padding: 6px;
      border: 1px solid var(--hud-line);
      border-radius: 4px;
      background: var(--hud-bg);
      color: var(--hud-ink);
      font: 600 11px/1.2 var(--font-text);
      cursor: pointer;
      box-shadow: var(--hud-shadow);
    }

    .minimap:focus-visible { outline: 2px solid var(--hud-focus); outline-offset: 2px; }

    svg {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      border-radius: 4px;
      background: var(--hud-water);
    }

    .bridge { stroke: var(--hud-bridge); }

    circle { stroke: rgb(0 0 0 / 25%); stroke-width: 0.5; }
    circle.near { stroke: var(--hud-ink); stroke-width: 1.6; }

    .me path {
      fill: var(--hud-gold);
      stroke: var(--hud-ink);
      stroke-width: 1.2;
      stroke-linejoin: round;
    }

    .here {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
  `,
})
export class PolisMinimapComponent {
  readonly places = input.required<Place[]>();
  readonly where = input<Whereabouts | null>(null);
  readonly near = input<string | null>(null);
  readonly expand = output<void>();

  readonly agoraId = AGORA_ID;
  readonly bridgeWidth = BRIDGE_WIDTH;
  readonly box = computed(() => {
    const extent = Math.max(...this.places().map((p) => Math.hypot(p.x, p.z) + p.radius), 30) + 4;
    return `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;
  });
  readonly hereText = computed(() => {
    const place = this.places().find((p) => p.id === this.near());
    return place ? `Estás en: ${place.title}` : 'Estás de camino';
  });
}
