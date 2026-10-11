import { Injectable, signal } from '@angular/core';
import { AgentNames, agentLabel, agentNames } from '../domain/agent-label';
import { AgentInfo } from '../domain/topology';

/**
 * Directorio de agentes compartido por toda la app: aprende los nombres visibles de la topología publicada por la
 * API (cada agente los declara en su manifiesto, ADR-013, catálogo de agentes). Ningún componente conoce a un agente por su nombre.
 */
@Injectable({ providedIn: 'root' })
export class AgentDirectory {
  private readonly names = signal<AgentNames>({});

  learn(agents: readonly AgentInfo[]): void {
    this.names.set(agentNames(agents));
  }

  /** Reactivo: leerlo en una plantilla la vuelve a pintar cuando llega la topología. */
  readonly label = (name: string): string => agentLabel(name, this.names());
}
