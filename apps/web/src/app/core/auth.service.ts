import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  readonly token = signal<string | null>(null); // en memoria; persiste solo si decides hacerlo

  async register(username: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post(`${API_BASE_URL}/v1/auth/register`, { username, password }));
  }

  async login(username: string, password: string): Promise<void> {
    const body = new HttpParams().set('username', username).set('password', password);
    const res = await firstValueFrom(
      this.http.post<{ access_token: string }>(`${API_BASE_URL}/v1/auth/token`, body),
    );
    this.token.set(res.access_token);
  }

  logout(): void { this.token.set(null); }
}
