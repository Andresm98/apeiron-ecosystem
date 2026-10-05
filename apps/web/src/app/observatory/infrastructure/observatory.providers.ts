import { Provider } from '@angular/core';
import { RunHistoryRepository } from '../../research/application/ports/run-history.repository';
import { TopologyRepository } from '../../research/application/ports/topology.repository';
import { HttpRunHistoryRepository } from '../../research/infrastructure/http-run-history.repository';
import { HttpTopologyRepository } from '../../research/infrastructure/http-topology.repository';
import { ObservatoryStore } from '../application/observatory.store';
import { SystemStatusRepository } from '../application/ports/system-status.repository';
import { HttpSystemStatusRepository } from './http-system-status.repository';

/** Enlaza los puertos del observatorio con sus adaptadores. Se registra en la ruta (lazy). */
export function provideObservatory(): Provider[] {
  return [
    ObservatoryStore,
    { provide: SystemStatusRepository, useClass: HttpSystemStatusRepository },
    { provide: RunHistoryRepository, useClass: HttpRunHistoryRepository },
    { provide: TopologyRepository, useClass: HttpTopologyRepository },
  ];
}
