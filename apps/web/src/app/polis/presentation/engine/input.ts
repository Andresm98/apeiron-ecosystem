/**
 * Entrada de la Polis: teclado (WASD/flechas), arrastre de cámara y rueda. El joystick táctil es un componente
 * visible del HUD que entrega su vector con `setStick` (ADR-013 §5.6): arrastrar en el lienzo siempre mira.
 */
export interface InputHandlers {
  /** Arrastre de cámara en píxeles. */
  look(dx: number, dy: number): void;
  zoom(delta: number): void;
  /** Clic o toque sin arrastre, en coordenadas del elemento. */
  tap(x: number, y: number): void;
  hover(x: number, y: number): void;
  key(key: 'interact' | 'map' | 'escape' | 'jump'): void;
  /** Atajos de gestos 1–5 (índice 0–4). */
  emote(index: number): void;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export class PolisInput {
  private readonly pressed = new Set<string>();
  private sprint = false;
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private stick = { x: 0, y: 0 };
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly el: HTMLElement, private readonly on: InputHandlers) {
    this.listen(window, 'keydown', (e) => this.keydown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.keyup(e as KeyboardEvent));
    this.listen(window, 'blur', () => this.pressed.clear());
    this.listen(el, 'pointerdown', (e) => this.down(e as PointerEvent));
    this.listen(el, 'pointermove', (e) => this.move(e as PointerEvent));
    this.listen(el, 'pointerup', (e) => this.up(e as PointerEvent));
    this.listen(el, 'pointercancel', () => this.release());
    this.listen(el, 'wheel', (e) => {
      e.preventDefault();
      this.on.zoom(Math.sign((e as WheelEvent).deltaY));
    }, { passive: false });
    this.listen(el, 'contextmenu', (e) => e.preventDefault());
  }

  /** Dirección pedida: x lateral, y adelante; ambos en [-1, 1]. */
  direction(): { x: number; y: number; sprint: boolean } {
    let x = this.stick.x;
    let y = this.stick.y;
    for (const code of this.pressed) {
      const [dx, dy] = MOVE_KEYS[code] ?? [0, 0];
      x += dx;
      y += dy;
    }
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length, sprint: this.sprint } : { x, y, sprint: this.sprint };
  }

  /** Vector del joystick del HUD: x lateral, y adelante, en [-1, 1]. */
  setStick(x: number, y: number): void {
    this.stick = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  /** ¿Pide el usuario algo (moverse o mirar)? La introducción de cámara se interrumpe al primer gesto. */
  active(): boolean {
    return this.pressed.size > 0 || this.stick.x !== 0 || this.stick.y !== 0 || !!this.drag;
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
    this.pressed.clear();
  }

  private keydown(e: KeyboardEvent): void {
    if (isTyping(e.target)) return;
    if (e.code in MOVE_KEYS) {
      this.pressed.add(e.code);
      e.preventDefault();
    }
    if (e.key === 'Shift') this.sprint = true;
    if (e.code === 'Space') e.preventDefault(); // no desplaza la página
    if (e.repeat) return;
    if (e.code === 'Space') this.on.key('jump');
    const digit = /^Digit([1-5])$/.exec(e.code);
    if (digit) this.on.emote(Number(digit[1]) - 1);
    if (e.code === 'KeyE' || e.code === 'Enter') this.on.key('interact');
    if (e.code === 'KeyM') this.on.key('map');
    if (e.code === 'Escape') this.on.key('escape');
  }

  private keyup(e: KeyboardEvent): void {
    this.pressed.delete(e.code);
    if (e.key === 'Shift') this.sprint = false;
  }

  private down(e: PointerEvent): void {
    if (this.drag) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    this.el.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    if (!this.drag || this.drag.id !== e.pointerId) {
      if (e.pointerType === 'mouse') this.on.hover(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.on.look(dx, dy);
  }

  private up(e: PointerEvent): void {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const rect = this.el.getBoundingClientRect();
    if (this.drag.moved < 6) this.on.tap(e.clientX - rect.left, e.clientY - rect.top);
    this.release();
  }

  private release(): void {
    if (this.drag && this.el.hasPointerCapture(this.drag.id)) this.el.releasePointerCapture(this.drag.id);
    this.drag = null;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, options);
    this.cleanup.push(() => target.removeEventListener(type, fn, options));
  }
}
