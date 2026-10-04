import { EnvironmentProviders, Provider, inject, provideAppInitializer } from '@angular/core';
import { AuthService } from '../application/auth.service';
import { AuthGateway } from '../application/ports/auth.gateway';
import { RuntimeAuthGateway } from './runtime-auth.gateway';

/** Enlaza el puerto de auth y restaura la sesión antes de que los guards decidan la ruta. */
export function provideAuth(): (Provider | EnvironmentProviders)[] {
  return [
    { provide: AuthGateway, useClass: RuntimeAuthGateway },
    provideAppInitializer(() => inject(AuthService).init()),
  ];
}
