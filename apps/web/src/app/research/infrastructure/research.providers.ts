import { Provider } from '@angular/core';
import { ResearchStore } from '../application/research.store';
import { ChatStreamPort } from '../application/ports/chat-stream.port';
import { RunHistoryRepository } from '../application/ports/run-history.repository';
import { TopologyRepository } from '../application/ports/topology.repository';
import { HttpRunHistoryRepository } from './http-run-history.repository';
import { HttpTopologyRepository } from './http-topology.repository';
import { SseChatStreamAdapter } from './sse-chat-stream.adapter';

/** Enlaza los puertos de research con sus adaptadores. Se registra en la ruta (lazy). */
export function provideResearch(): Provider[] {
  return [
    ResearchStore,
    { provide: ChatStreamPort, useClass: SseChatStreamAdapter },
    { provide: TopologyRepository, useClass: HttpTopologyRepository },
    { provide: RunHistoryRepository, useClass: HttpRunHistoryRepository },
  ];
}
