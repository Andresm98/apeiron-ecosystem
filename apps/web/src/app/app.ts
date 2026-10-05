import { Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SessionStore } from './auth/application/session.store';
import { ThemeToggleComponent } from './shared/presentation/theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThemeToggleComponent],
  template: '<router-outlet /><app-theme-toggle />',
})
export class App {
  constructor() {
    const session = inject(SessionStore);
    const router = inject(Router);
    // Logout o expiración del JWT en cualquier punto -> pantalla de acceso.
    effect(() => {
      if (!session.isAuthenticated() && !router.url.startsWith('/login')) void router.navigate(['/login']);
    });
  }
}
