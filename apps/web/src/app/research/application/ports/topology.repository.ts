import type { Topology } from '../../domain/topology.ts';

/** Puerto de salida: topología de agentes publicada por la API. */
export abstract class TopologyRepository {
  abstract load(): Promise<Topology>;
}
