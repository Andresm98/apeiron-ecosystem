import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { SystemStatusRepository } from '../application/ports/system-status.repository';
import { SystemStatus } from '../domain/system-status';

@Injectable()
export class HttpSystemStatusRepository extends SystemStatusRepository {
  private http = inject(HttpClient);

  load(): Promise<SystemStatus> {
    return firstValueFrom(this.http.get<SystemStatus>(`${API_BASE_URL}/v1/system`));
  }
}
