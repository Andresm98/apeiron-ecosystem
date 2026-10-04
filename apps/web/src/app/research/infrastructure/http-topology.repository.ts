import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { TopologyRepository } from '../application/ports/topology.repository';
import { Topology } from '../domain/topology';

@Injectable()
export class HttpTopologyRepository extends TopologyRepository {
  private http = inject(HttpClient);

  load(): Promise<Topology> {
    return firstValueFrom(this.http.get<Topology>(`${API_BASE_URL}/v1/agents`));
  }
}
