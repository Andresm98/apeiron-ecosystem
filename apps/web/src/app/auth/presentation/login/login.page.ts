import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../application/auth.service';
import { SessionStore } from '../../application/session.store';
import { AuthError } from '../../domain/auth-error';
import { validateCredentials } from '../../domain/credentials';

type Tab = 'login' | 'register';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private router = inject(Router);
  private auth = inject(AuthService);
  readonly session = inject(SessionStore);

  readonly tab = signal<Tab>('login');
  readonly canRegister = computed(() => this.session.capabilities().registrationOpen);
  readonly usesEmail = computed(() => this.session.capabilities().identifier === 'email');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);

  username = '';
  password = '';
  confirm = '';

  select(tab: Tab): void {
    this.tab.set(tab);
    this.error.set('');
    this.confirm = '';
  }

  async submit(): Promise<void> {
    const register = this.tab() === 'register';
    const invalid = validateCredentials(
      { username: this.username, password: this.password, confirm: this.confirm },
      register,
      this.session.capabilities().identifier,
    );
    if (invalid) {
      this.error.set(invalid);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const credentials = { username: this.username.trim(), password: this.password };
      if (register && (await this.auth.signUp(credentials)) === 'confirm-email') {
        this.select('login');
        this.password = '';
        this.session.notice.set(
          `Te enviamos un enlace de confirmación a ${credentials.username}. Ábrelo y luego inicia sesión.`,
        );
        return;
      }
      if (!register) await this.auth.signIn(credentials);
      this.password = '';
      this.confirm = '';
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(e instanceof AuthError ? e.message : 'No se pudo completar el acceso.');
    } finally {
      this.busy.set(false);
    }
  }
}
