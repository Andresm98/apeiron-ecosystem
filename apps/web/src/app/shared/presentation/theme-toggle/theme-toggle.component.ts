import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'apeiron-theme';

/** Interruptor de tema día/noche: solo aspecto, persiste la preferencia en localStorage. */
@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="theme-toggle"
      type="button"
      (click)="toggle()"
      [attr.aria-label]="isDark() ? 'Cambiar a tema de día' : 'Cambiar a tema de noche'"
      [title]="isDark() ? 'Tema de día' : 'Tema de noche'"
    >
      @if (isDark()) {
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
          />
        </svg>
      } @else {
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
        </svg>
      }
    </button>
  `,
  styles: `
    :host {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 50;
    }

    .theme-toggle {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 50%;
      color: var(--forest);
      background: var(--surface);
      box-shadow: 0 2px 10px var(--shadow);
      cursor: pointer;
      transition:
        transform 0.15s ease,
        background 0.2s ease;
    }

    .theme-toggle:hover {
      transform: scale(1.06);
    }

    svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class ThemeToggleComponent {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly theme = signal<Theme>(this.initial());
  protected readonly isDark = computed(() => this.theme() === 'dark');

  protected toggle(): void {
    const next: Theme = this.isDark() ? 'light' : 'dark';
    this.theme.set(next);
    this.root.dataset['theme'] = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento (modo privado): el tema vale solo para esta pestaña.
    }
  }

  private initial(): Theme {
    const forced = this.root.dataset['theme'];
    if (forced === 'light' || forced === 'dark') return forced;
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
