import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgentStateStore } from './core/agent-state.store';
import { AuthService } from './core/auth.service';
import { Mode, UseCase } from './core/models';
import { USE_CASES } from './core/use-cases';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly auth = inject(AuthService);
  readonly state = inject(AgentStateStore);
  readonly useCases = USE_CASES;
  readonly selectedCaseId = signal(USE_CASES[0]?.id ?? 1);
  readonly submittedQuestion = signal('');
  readonly authError = signal('');
  readonly authBusy = signal(false);

  username = '';
  password = '';
  question = USE_CASES[0]?.prompt ?? '';
  mode: Mode = USE_CASES[0]?.mode ?? 'single';

  async authenticate(register: boolean): Promise<void> {
    const username = this.username.trim();
    if (!username || !this.password) {
      this.authError.set('Escribe usuario y contraseña.');
      return;
    }

    this.authBusy.set(true);
    this.authError.set('');
    try {
      if (register) await this.auth.register(username, this.password);
      await this.auth.login(username, this.password);
      this.password = '';
    } catch (error) {
      this.authError.set(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      this.authBusy.set(false);
    }
  }

  selectCase(useCase: UseCase): void {
    this.selectedCaseId.set(useCase.id);
    this.question = useCase.prompt;
    this.mode = useCase.mode;
  }

  submitQuestion(): void {
    const question = this.question.trim();
    if (!this.auth.token() || !question || this.state.status() === 'running') return;
    this.submittedQuestion.set(question);
    this.state.run({ question, mode: this.mode });
  }

  cancel(): void {
    this.state.cancel();
  }

  logout(): void {
    this.state.clear();
    this.submittedQuestion.set('');
    this.auth.logout();
  }
}