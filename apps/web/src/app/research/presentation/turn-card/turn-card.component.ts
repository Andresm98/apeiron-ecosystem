import { Component, inject, input } from '@angular/core';
import { AgentDirectory } from '../../application/agent-directory';
import { AgentStep, Turn } from '../../domain/chat';
import { excerpt } from '../../domain/dialogue';

/** Intervención de un worker: a quién responde, qué dijo y con qué evidencia. */
@Component({
  selector: 'app-turn-card',
  templateUrl: './turn-card.component.html',
  styleUrl: './turn-card.component.scss',
  host: { '[class.reply]': 'reply()', '[class.degraded]': 'turn().degraded' },
})
export class TurnCardComponent {
  readonly turn = input.required<Turn>();
  readonly replied = input<Turn | null>(null);
  readonly evidence = input<AgentStep[]>([]);
  readonly reply = input(false);
  /** Worker externo vía A2A: su evidencia vive en el otro agente. */
  readonly remote = input(false);

  readonly agentLabel = inject(AgentDirectory).label;
  readonly excerpt = excerpt;
}
