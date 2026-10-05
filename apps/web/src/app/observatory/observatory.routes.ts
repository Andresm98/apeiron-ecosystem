import { Routes } from '@angular/router';
import { provideObservatory } from './infrastructure/observatory.providers';

/** Raíz de composición del contexto: los adaptadores viajan en el chunk lazy. */
export const observatoryRoutes: Routes = [
  {
    path: '',
    providers: [provideObservatory()],
    loadComponent: () => import('./presentation/system/system.page').then((m) => m.SystemPage),
  },
];
