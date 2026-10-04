import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { AuthService } from '../application/auth.service';
import { SessionStore } from '../application/session.store';

/** Añade el Bearer a la API (salvo /v1/auth) y cierra la sesión si el token ya no vale. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionStore);
  const injector = inject(Injector); // AuthService se resuelve tarde: evita el ciclo con HttpClient
  const token = session.token();
  const isApi = req.url.startsWith(API_BASE_URL);
  const isAuthEndpoint = req.url.startsWith(`${API_BASE_URL}/v1/auth/`);
  const authed = token && isApi && !isAuthEndpoint
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;
  return next(authed).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && isApi && !isAuthEndpoint) {
        injector.get(AuthService).expire();
      }
      return throwError(() => error);
    }),
  );
};
