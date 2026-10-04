import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '../application/session.store';

export const authGuard: CanActivateFn = () =>
  inject(SessionStore).isAuthenticated() || inject(Router).createUrlTree(['/login']);

export const guestGuard: CanActivateFn = () =>
  !inject(SessionStore).isAuthenticated() || inject(Router).createUrlTree(['/']);
