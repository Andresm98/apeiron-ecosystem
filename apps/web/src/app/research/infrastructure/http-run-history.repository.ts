import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { RunHistoryRepository } from '../application/ports/run-history.repository';
import { RunRecord, RunSummary } from '../domain/run-record';

@Injectable()
export class HttpRunHistoryRepository extends RunHistoryRepository {
  private http = inject(HttpClient);

  list(limit = 20): Promise<RunSummary[]> {
    return firstValueFrom(this.http.get<RunSummary[]>(`${API_BASE_URL}/v1/runs`, { params: { limit } }));
  }

  get(id: string): Promise<RunRecord> {
    return firstValueFrom(this.http.get<RunRecord>(`${API_BASE_URL}/v1/runs/${encodeURIComponent(id)}`));
  }
}
