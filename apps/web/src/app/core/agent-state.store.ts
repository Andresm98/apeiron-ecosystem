import { Injectable, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChatStreamService } from './chat-stream.service';
import { ChatRequest, Turn } from './models';

export type Status = 'idle' | 'running' | 'done' | 'error';

/** Estado para el Agent State Viewer: [Ápeiron Routing] -> [anaximandro Thinking r0] -> ... */
@Injectable({ providedIn: 'root' })
export class AgentStateStore {
  private chat = inject(ChatStreamService);
  private sub?: Subscription;

  readonly status = signal<Status>('idle');
  readonly trace = signal<string[]>([]);
  readonly turns = signal<Turn[]>([]);
  readonly answer = signal('');
  readonly error = signal<string | null>(null);

  run(req: ChatRequest): void {
    this.sub?.unsubscribe();
    this.status.set('running');
    this.trace.set([]); this.turns.set([]); this.answer.set(''); this.error.set(null);
    this.sub = this.chat.stream(req).subscribe({
      next: (ev) => {
        if (ev.type === 'trace') this.trace.update((t) => [...t, ...ev.data.messages]);
        else if (ev.type === 'turn') this.turns.update((t) => [...t, ev.data]);
        else if (ev.type === 'answer') { this.answer.set(ev.data.answer); this.status.set('done'); }
        else if (ev.type === 'error') { this.error.set(ev.data.message); this.status.set('error'); }
      },
      error: (e) => { this.error.set(String(e)); this.status.set('error'); },
    });
  }

  cancel(): void { this.sub?.unsubscribe(); this.status.set('idle'); }
}
