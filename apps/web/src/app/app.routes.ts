import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/presentation/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Ápeiron | Acceso',
    loadComponent: () => import('./auth/presentation/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'sistema',
    canActivate: [authGuard],
    title: 'Ápeiron | Sistema',
    loadChildren: () => import('./observatory/observatory.routes').then((m) => m.observatoryRoutes),
  },
  {
    path: '',
    canActivate: [authGuard],
    title: 'Ápeiron | Consola',
    loadChildren: () => import('./research/research.routes').then((m) => m.researchRoutes),
  },
  { path: '**', redirectTo: '' },
];
