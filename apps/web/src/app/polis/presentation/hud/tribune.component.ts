import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliberationDraft, HUMAN, MAX_PARTICIPANTS } from '../../domain/deliberation';
import { PRESETS, Preset, SUGGESTIONS, applyPreset, presetOf } from '../../domain/hud';

export interface TribuneCitizen { name: string; label: string; color: string; role: string; }

/**
 * Tribuna del ágora (ADR-013 §5.6): convocar una deliberación sin que parezca un formulario de ajustes. Pregunta
 * grande con sugerencias, participantes como tarjetas, tres presets y las opciones finas plegadas.
 */
@Component({
  selector: 'app-polis-tribune',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tribune">
      <label class="question">
        <span>¿Qué quieres deliberar?</span>
        <textarea rows="3" [(ngModel)]="question" maxlength="4000" placeholder="Plantea la pregunta del debate…"></textarea>
      </label>
      <div class="suggestions" aria-label="Sugerencias">
        @for (s of suggestions; track s) {
          <button type="button" (click)="question.set(s)">{{ s }}</button>
        }
      </div>

      <fieldset>
        <legend>Participantes · {{ draft().participants.length }}/{{ max }}</legend>
        <div class="cards">
          @for (c of citizens(); track c.name) {
            <button type="button" class="card" [style.--tone]="c.color" [attr.aria-pressed]="has(c.name)" (click)="toggle(c.name)">
              <strong>{{ c.label }}</strong><small>{{ c.role }}</small>
            </button>
          }
          <button type="button" class="card self" [attr.aria-pressed]="has(human)" (click)="toggle(human)">
            <strong>Tú ({{ player() }})</strong><small>Tomas la palabra en tu turno</small>
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Formato</legend>
        <div class="presets">
          @for (p of presets; track p.id) {
            <button type="button" class="preset" [attr.aria-pressed]="preset() === p.id" (click)="choose(p.id)">
              <strong>{{ p.title }}</strong><small>{{ p.summary }}</small>
            </button>
          }
        </div>
      </fieldset>

      <details [open]="!preset()">
        <summary>Opciones avanzadas{{ preset() ? '' : ' · personalizado' }}</summary>
        <div class="advanced">
          <label class="check"><input type="checkbox" [checked]="draft().openEnded" (change)="set('openEnded', !draft().openEnded)" /> Debate abierto (lo cierras tú)</label>
          @if (!draft().openEnded) {
            <label>Rondas
              <select (change)="set('rounds', +$any($event.target).value)">
                @for (n of [1, 2, 3, 4]; track n) { <option [value]="n" [selected]="n === draft().rounds">{{ n }}</option> }
              </select>
            </label>
          }
          <label>Tiempo máximo
            <select (change)="set('budgetMin', $any($event.target).value === '' ? null : +$any($event.target).value)">
              <option value="" [selected]="draft().budgetMin === null">sin límite propio</option>
              @for (m of [1, 2, 3, 5, 10, 15, 30]; track m) { <option [value]="m" [selected]="m === draft().budgetMin">{{ m }} min</option> }
            </select>
          </label>
          <label>Ritmo
            <select (change)="set('pace', $any($event.target).value)">
              <option value="auto" [selected]="draft().pace === 'auto'">automático</option>
              <option value="step" [selected]="draft().pace === 'step'">paso a paso (tú das la palabra)</option>
            </select>
          </label>
          @if (draft().pace === 'auto') {
            <label>Pausa entre turnos
              <select (change)="set('turnDelayS', +$any($event.target).value)">
                @for (s of [0, 2, 5, 10, 20]; track s) { <option [value]="s" [selected]="s === draft().turnDelayS">{{ s }} s</option> }
              </select>
            </label>
          }
          @if (has(human)) {
            <label>Tu tiempo para responder
              <select (change)="set('replyMin', +$any($event.target).value)">
                @for (m of [1, 2, 4, 6, 10]; track m) { <option [value]="m" [selected]="m === draft().replyMin">{{ m }} min</option> }
              </select>
            </label>
          }
        </div>
      </details>

      <p class="cost">{{ cost() }}</p>
      @if (notice()) { <p class="notice" role="alert">{{ notice() }}</p> }
      <button type="button" class="convene" (click)="convene.emit(question())">Convocar</button>
    </div>
  `,
  styles: `
    :host { display: block; }

    .tribune { display: grid; gap: 12px; }

    .question { display: grid; gap: 6px; font: 650 16px var(--font-display); }

    textarea, select {
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--hud-line);
      border-radius: 4px;
      background: var(--hud-field);
      color: var(--hud-ink);
      font: 400 15px var(--font-text);
    }

    textarea { width: 100%; resize: vertical; }

    .suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -4px; }

    .suggestions button {
      padding: 4px 10px;
      border: 1px dashed var(--hud-line);
      border-radius: 4px;
      background: transparent;
      color: var(--hud-muted);
      font: 400 12px var(--font-text);
      cursor: pointer;
    }

    fieldset { margin: 0; padding: 0; border: 0; }

    legend, summary {
      margin-bottom: 6px;
      color: var(--hud-muted);
      font: 600 11px var(--font-text);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    summary { cursor: pointer; }

    .cards, .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }

    .card, .preset {
      --tone: var(--hud-accent);
      display: grid;
      gap: 2px;
      padding: 8px 10px;
      border: 1px solid var(--hud-line);
      border-left: 4px solid var(--tone);
      border-radius: 4px;
      background: var(--hud-field);
      color: var(--hud-ink);
      font: 400 13px/1.25 var(--font-text);
      text-align: left;
      cursor: pointer;
      opacity: 0.7;

      small { color: var(--hud-muted); font-size: 11px; }
    }

    .card.self { --tone: var(--hud-gold); }
    .preset { border-left-width: 1px; }

    [aria-pressed='true'] {
      opacity: 1;
      border-color: var(--tone);
      box-shadow: inset 0 0 0 1px var(--tone);
      background: var(--hud-selected);
    }

    button:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible {
      outline: 2px solid var(--hud-focus);
      outline-offset: 2px;
    }

    .advanced { display: grid; gap: 8px; font-size: 13px; }
    .advanced label { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .advanced .check { justify-content: flex-start; }

    .cost { margin: 0; color: var(--hud-muted); font-size: 13px; }
    .notice { margin: 0; color: var(--hud-danger); }

    .convene {
      min-height: 44px;
      border: 0;
      border-radius: 4px;
      background: var(--hud-accent);
      color: var(--hud-on-accent);
      font: 650 15px var(--font-text);
      cursor: pointer;
    }
  `,
})
export class PolisTribuneComponent {
  readonly draft = input.required<DeliberationDraft>();
  readonly citizens = input.required<TribuneCitizen[]>();
  readonly player = input.required<string>();
  readonly simulate = input(true);
  readonly estimate = input<number | null>(null);
  readonly maxCalls = input(60);
  readonly notice = input('');
  readonly draftChange = output<DeliberationDraft>();
  readonly convene = output<string>();

  readonly human = HUMAN;
  readonly max = MAX_PARTICIPANTS;
  readonly presets = PRESETS;
  readonly suggestions = SUGGESTIONS;
  readonly question = signal('');
  readonly preset = computed(() => presetOf(this.draft()));
  readonly cost = computed(() => {
    if (this.simulate()) return 'Simulación: 0 tokens.';
    const calls = this.estimate();
    return calls === null ? `Debate abierto: hasta ${this.maxCalls()} llamadas al modelo (tope duro).` : `Unas ${calls} llamadas al modelo.`;
  });

  has(name: string): boolean {
    return this.draft().participants.includes(name);
  }

  toggle(name: string): void {
    const d = this.draft();
    this.draftChange.emit({
      ...d,
      participants: this.has(name) ? d.participants.filter((p) => p !== name) : [...d.participants, name],
    });
  }

  choose(preset: Preset): void {
    this.draftChange.emit(applyPreset(this.draft(), preset));
  }

  set<K extends keyof DeliberationDraft>(key: K, value: DeliberationDraft[K]): void {
    this.draftChange.emit({ ...this.draft(), [key]: value });
  }
}
