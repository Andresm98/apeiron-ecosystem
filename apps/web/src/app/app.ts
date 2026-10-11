import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { SessionStore } from './auth/application/session.store';
import { ThemeToggleComponent } from './shared/presentation/theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThemeToggleComponent],
  // La Polis tiene su propia paleta y su HUD ocupa las esquinas: allí no se muestra el tema global (ADR-013 §5.6).
  template: '<router-outlet />@if (!inPolis()) { <app-theme-toggle /> }',
})
export class App {
  private readonly router = inject(Router);
  readonly inPolis = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/polis')),
    ),
    { initialValue: false },
  );

  constructor() {
    const session = inject(SessionStore);
    // Logout o expiración del JWT en cualquier punto -> pantalla de acceso.
    effect(() => {
      if (!session.isAuthenticated() && !this.router.url.startsWith('/login')) void this.router.navigate(['/login']);
    });
  }
}
