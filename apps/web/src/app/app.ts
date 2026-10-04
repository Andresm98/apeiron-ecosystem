import { Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SessionStore } from './auth/application/session.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
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
