import { Provider } from '@angular/core';
import { SystemStatusRepository } from '../../observatory/application/ports/system-status.repository';
import { HttpSystemStatusRepository } from '../../observatory/infrastructure/http-system-status.repository';
import { provideResearch } from '../../research/infrastructure/research.providers';
import { PolisStore } from '../application/polis.store';
import { DeliberationPort } from '../application/ports/deliberation.port';
import { HttpDeliberationAdapter } from './http-deliberation.adapter';

/** Enlaza los puertos de la Polis: research (chat, topología, historial), sesiones y el Faro (`/v1/system`). */
export function providePolis(): Provider[] {
  return [
    ...provideResearch(),
    PolisStore,
    { provide: DeliberationPort, useClass: HttpDeliberationAdapter },
    { provide: SystemStatusRepository, useClass: HttpSystemStatusRepository },
  ];
}
