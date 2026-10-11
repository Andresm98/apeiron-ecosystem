import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

const REACH = 44; // px desde el centro hasta el tope

/** Joystick táctil visible (ADR-013 §5.6). Solo se muestra con puntero grueso; entrega x lateral e y adelante. */
@Component({
  selector: 'app-polis-joystick',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pad" aria-hidden="true"
      (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)">
      <span class="knob" [style.transform]="'translate(' + knob().x + 'px, ' + knob().y + 'px)'"></span>
    </div>
  `,
  styles: `
    :host { display: block; }

    .pad {
      display: grid;
      place-items: center;
      width: 128px;
      height: 128px;
      border: 2px solid rgb(255 255 255 / 55%);
      border-radius: 50%;
      background: rgb(20 32 26 / 35%);
      touch-action: none;
      backdrop-filter: blur(4px);
    }

    .knob {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: rgb(255 252 245 / 92%);
      box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
    }
  `,
})
export class PolisJoystickComponent {
  readonly stick = output<{ x: number; y: number }>();
  readonly knob = signal({ x: 0, y: 0 });
  private origin: { id: number; x: number; y: number } | null = null;

  down(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.origin = { id: e.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    el.setPointerCapture(e.pointerId);
    this.move(e);
  }

  move(e: PointerEvent): void {
    if (!this.origin || e.pointerId !== this.origin.id) return;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const length = Math.hypot(dx, dy);
    if (length > REACH) {
      dx = (dx / length) * REACH;
      dy = (dy / length) * REACH;
    }
    this.knob.set({ x: dx, y: dy });
    this.stick.emit({ x: dx / REACH, y: -dy / REACH });
  }

  up(e: PointerEvent): void {
    if (!this.origin || e.pointerId !== this.origin.id) return;
    this.origin = null;
    this.knob.set({ x: 0, y: 0 });
    this.stick.emit({ x: 0, y: 0 });
  }
}
