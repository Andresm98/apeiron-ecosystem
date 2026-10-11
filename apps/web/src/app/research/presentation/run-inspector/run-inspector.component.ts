import { Component, ElementRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { AgentDirectory } from '../../application/agent-directory';
import { ResearchStore } from '../../application/research.store';
import { describeGuard } from '../../domain/guardrails';
import { AgentGraphComponent } from '../agent-graph/agent-graph.component';

const CLOSE_DELAY_MS = 220; // margen para llevar el puntero de la etiqueta al popover sin que se cierre

/**
 * Inspector de la ejecución (ADR-014): una etiqueta compacta en la cabecera de la consola que, al pasar el puntero
 * o al enfocarla, despliega el grafo LangGraph en vivo con el consumo, los guardrails y la traza. Un clic lo fija
 * (útil en pantallas táctiles) y Escape lo cierra.
 */
@Component({
  selector: 'app-run-inspector',
  imports: [AgentGraphComponent],
  templateUrl: './run-inspector.component.html',
  styleUrl: './run-inspector.component.scss',
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hideSoon()',
    '(focusin)': 'show()',
    '(focusout)': 'onFocusOut($event)',
    '(document:keydown.escape)': 'close()',
    '(document:pointerdown)': 'onOutside($event)',
  },
})
export class RunInspectorComponent implements OnDestroy {
  readonly state = inject(ResearchStore);
  readonly agentLabel = inject(AgentDirectory).label;
  readonly describeGuard = describeGuard;
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly open = signal(false);
  readonly pinned = signal(false);

  readonly model = computed(() => this.state.topology()?.llm.model ?? 'LLM configurado');
  readonly statusLabel = computed(() => {
    switch (this.state.status()) {
      case 'running': return 'en ejecución';
      case 'done': return 'completado';
      case 'error': return 'con errores';
      case 'cancelled': return 'cancelado';
      default: return 'en espera';
    }
  });
  /** Nodo más interno activo («Feynman · act»), para la etiqueta mientras corre. */
  readonly activeNode = computed(() => {
    const status = this.state.graph().status;
    const active = Object.keys(status).filter((k) => status[k] === 'active').sort((a, b) => b.length - a.length)[0];
    if (!active) return '';
    const [agent, inner] = active.split('/');
    const name = agent.startsWith('apeiron_') ? `Ápeiron · ${agent.slice(8)}` : this.agentLabel(agent);
    return inner ? `${name} · ${inner}` : name;
  });

  show(): void {
    clearTimeout(this.timer);
    this.open.set(true);
  }

  hideSoon(): void {
    if (this.pinned()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open.set(false), CLOSE_DELAY_MS);
  }

  toggle(): void {
    const pin = !this.pinned();
    this.pinned.set(pin);
    this.open.set(pin);
  }

  close(): void {
    clearTimeout(this.timer);
    this.pinned.set(false);
    this.open.set(false);
  }

  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !this.host.nativeElement.contains(next)) this.hideSoon();
  }

  onOutside(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
