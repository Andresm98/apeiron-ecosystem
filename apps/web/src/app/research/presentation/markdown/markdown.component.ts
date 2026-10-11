import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { parseMarkdown } from '../../domain/markdown';

/**
 * Markdown de los agentes (ADR-014). Pinta el árbol de `parseMarkdown` con plantillas: nunca usa `innerHTML`,
 * así que el texto del LLM no puede inyectar HTML ni scripts.
 */
@Component({
  selector: 'app-markdown',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './markdown.component.scss',
  template: `
    <ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: blocks() }" />

    <ng-template #blocksTpl let-blocks>
      @for (b of blocks; track $index) {
        @switch (b.kind) {
          @case ('heading') {
            @switch (b.level) {
              @case (1) { <h3 class="md-h1"><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: b.children }" /></h3> }
              @case (2) { <h4 class="md-h2"><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: b.children }" /></h4> }
              @default { <h5 class="md-h3"><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: b.children }" /></h5> }
            }
          }
          @case ('paragraph') { <p><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: b.children }" /></p> }
          @case ('code') {
            <pre [attr.data-lang]="b.lang || null"><code>{{ b.text }}</code></pre>
          }
          @case ('quote') {
            <blockquote><ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: b.children }" /></blockquote>
          }
          @case ('list') {
            @if (b.ordered) {
              <ol [attr.start]="b.start === 1 ? null : b.start">
                @for (item of b.items; track $index) {
                  <li><ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: item }" /></li>
                }
              </ol>
            } @else {
              <ul>
                @for (item of b.items; track $index) {
                  <li><ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: item }" /></li>
                }
              </ul>
            }
          }
          @case ('table') {
            <div class="md-table">
              <table>
                <thead>
                  <tr>
                    @for (cell of b.head; track $index) {
                      <th [style.text-align]="b.align[$index]"><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: cell }" /></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of b.rows; track $index) {
                    <tr>
                      @for (cell of row; track $index) {
                        <td [style.text-align]="b.align[$index]"><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: cell }" /></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @case ('rule') { <hr /> }
        }
      }
    </ng-template>

    <ng-template #inlineTpl let-nodes>
      @for (n of nodes; track $index) {
        @switch (n.kind) {
          @case ('text') {<ng-container>{{ n.text }}</ng-container>}
          @case ('break') { <br /> }
          @case ('code') { <code>{{ n.text }}</code> }
          @case ('strong') { <strong><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: n.children }" /></strong> }
          @case ('em') { <em><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: n.children }" /></em> }
          @case ('del') { <del><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: n.children }" /></del> }
          @case ('link') {
            <a [href]="n.href" target="_blank" rel="noopener noreferrer"><ng-container *ngTemplateOutlet="inlineTpl; context: { $implicit: n.children }" /></a>
          }
        }
      }
    </ng-template>
  `,
})
export class MarkdownComponent {
  readonly text = input.required<string>();
  readonly blocks = computed(() => parseMarkdown(this.text()));
}
