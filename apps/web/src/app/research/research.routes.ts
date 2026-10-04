import { Routes } from '@angular/router';
import { provideResearch } from './infrastructure/research.providers';

/** Raíz de composición del contexto: los adaptadores viajan en el chunk lazy. */
export const researchRoutes: Routes = [
  {
    path: '',
    providers: [provideResearch()],
    loadComponent: () => import('./presentation/workspace/workspace.page').then((m) => m.WorkspacePage),
  },
];
