import { Routes } from '@angular/router';
import { providePolis } from './infrastructure/polis.providers';

/** Raíz de composición de la Polis (ADR-013): adaptadores en la ruta lazy; Three.js viaja en el chunk del motor. */
export const polisRoutes: Routes = [
  {
    path: '',
    providers: [providePolis()],
    loadComponent: () => import('./presentation/polis.page').then((m) => m.PolisPage),
  },
];
