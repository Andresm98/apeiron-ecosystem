/**
 * Markdown de los agentes como árbol de nodos (ADR-014). La vista lo pinta con plantillas de Angular, sin
 * `innerHTML`: ningún texto del LLM llega al DOM como HTML, así que no hay XSS posible por construcción.
 *
 * Subconjunto de CommonMark + GFM que usan los LLM: títulos, párrafos, listas (anidadas), citas, código,
 * tablas, separadores, negrita, cursiva, tachado, código en línea y enlaces http(s)/mailto. Un salto de línea
 * dentro de un párrafo se respeta (como escriben los modelos). Lo no reconocido queda como texto.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'del'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'break' };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

const MAX_DEPTH = 8; // citas y listas anidadas: cota contra entradas patológicas

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,12})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_DELIMITER = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const ESCAPABLE = '\\`*_{}[]()#+-.!|~<>';

/** Analiza el texto completo. Tolera Markdown sin cerrar (p. ej. un bloque de código sin la valla final). */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), 0);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) body.push(lines[i++]);
      i++; // la valla de cierre (si existe)
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, children: parseInline(heading[2] ?? '') });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      blocks.push({ kind: 'quote', children: depth < MAX_DEPTH ? parseBlocks(body, depth + 1) : [paragraph(body)] });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i, depth);
      blocks.push(list);
      i = next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const [table, next] = parseTable(lines, i);
      blocks.push(table);
      i = next;
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !(body.length && interrupts(lines, i))) body.push(lines[i++]);
    blocks.push(paragraph(body));
  }
  return blocks;
}

function paragraph(lines: string[]): Block {
  return { kind: 'paragraph', children: parseInline(lines.map((l) => l.trim()).join('\n')) };
}

/** Una línea que abre otro bloque corta el párrafo en curso (como en GFM). */
function interrupts(lines: string[], i: number): boolean {
  const line = lines[i];
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
    || isTableStart(lines, i);
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-')
    && TABLE_DELIMITER.test(lines[i + 1]) && splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let k = 0; k < row.length; k++) {
    if (row[k] === '\\' && row[k + 1] === '|') {
      current += '|';
      k++;
    } else if (row[k] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += row[k];
    }
  }
  return [...cells, current.trim()];
}

function parseTable(lines: string[], start: number): [Block, number] {
  const head = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map((cell): Align => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
  const rows: Inline[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    const cells = splitRow(lines[i++]);
    rows.push(head.map((_, c) => parseInline(cells[c] ?? '')));
  }
  return [{ kind: 'table', align, head: head.map((cell) => parseInline(cell)), rows }, i];
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function parseList(lines: string[], start: number, depth: number): [Block, number] {
  const first = ITEM.exec(lines[start])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const item = ITEM.exec(line);
    if (item && item[1].length <= baseIndent + 1 && /\d/.test(item[2]) === ordered) {
      items.push([item[3]]); // nuevo elemento de esta lista
      i++;
      continue;
    }
    if (item && item[1].length <= baseIndent + 1) break; // otra clase de lista al mismo nivel
    if (!line.trim()) {
      // Una línea en blanco continúa el elemento solo si lo siguiente está sangrado o es otro elemento.
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && (indentOf(next) > baseIndent || ITEM.test(next))) {
        items[items.length - 1].push('');
        i++;
        continue;
      }
      break;
    }
    if (indentOf(line) > baseIndent || !interrupts(lines, i)) {
      items[items.length - 1].push(line); // continuación (sangrada o perezosa)
      i++;
      continue;
    }
    break;
  }
  const blocks = items.map((body) => {
    const dedented = body.map((l, k) => (k === 0 ? l : l.slice(Math.min(indentOf(l), baseIndent + 2))));
    return depth < MAX_DEPTH ? parseBlocks(dedented, depth + 1) : [paragraph(dedented)];
  });
  return [{ kind: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: blocks }, i];
}

/** Elementos en línea. Los delimitadores sin pareja quedan como texto literal. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && ESCAPABLE.includes(source[i + 1] ?? '')) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ kind: 'break' });
      i++;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(source.slice(i))![0];
      const end = source.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        out.push({ kind: 'code', text: source.slice(i + run.length, end).replace(/\n/g, ' ').trim() || run });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    const emphasis = matchEmphasis(source, i);
    if (emphasis) {
      flush();
      out.push({ kind: emphasis.kind, children: parseInline(emphasis.inner) });
      i = emphasis.end;
      continue;
    }
    if (ch === '[') {
      const link = matchLink(source, i);
      if (link) {
        flush();
        out.push(link.node);
        i = link.end;
        continue;
      }
    }
    if (ch === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(source.slice(i));
      if (auto) {
        flush();
        out.push({ kind: 'link', href: auto[1], children: [{ kind: 'text', text: auto[1] }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && !/\w/.test(source[i - 1] ?? '')) {
      const bare = /^https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/i.exec(source.slice(i));
      if (bare) {
        const url = bare[0].replace(/[.,;:!?'"»)\]]+$/, ''); // la puntuación final no es parte del enlace
        flush();
        out.push({ kind: 'link', href: url, children: [{ kind: 'text', text: url }] });
        i += url.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

interface EmphasisMatch { kind: 'strong' | 'em' | 'del'; inner: string; end: number; }

function matchEmphasis(source: string, i: number): EmphasisMatch | null {
  const candidates: [string, EmphasisMatch['kind']][] = [['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']];
  for (const [delimiter, kind] of candidates) {
    if (!source.startsWith(delimiter, i)) continue;
    const after = source[i + delimiter.length];
    if (after === undefined || /\s/.test(after) || after === delimiter[0]) continue;
    // `_` dentro de una palabra (snake_case) no es énfasis.
    if (delimiter[0] === '_' && /\w/.test(source[i - 1] ?? '')) continue;
    let from = i + delimiter.length;
    for (;;) {
      let close = source.indexOf(delimiter, from);
      if (close < 0) break;
      // `***` al cerrar un `**`: el doble cierra al final de la racha y el sobrante es del énfasis interior.
      if (delimiter.length === 2) while (source[close + 2] === delimiter[0]) close++;
      const before = source[close - 1];
      const tail = source[close + delimiter.length];
      const flanked = !/\s/.test(before) && !(delimiter.length === 1 && tail === delimiter);
      const wordEnd = delimiter[0] !== '_' || !/\w/.test(tail ?? '');
      if (close > i + delimiter.length && flanked && wordEnd) {
        return { kind, inner: source.slice(i + delimiter.length, close), end: close + delimiter.length };
      }
      from = close + delimiter.length;
    }
  }
  return null;
}

function matchLink(source: string, i: number): { node: Inline; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let k = i; k < source.length; k++) {
    if (source[k] === '\\') k++;
    else if (source[k] === '[') depth++;
    else if (source[k] === ']' && --depth === 0) {
      close = k;
      break;
    }
  }
  if (close < 0 || source[close + 1] !== '(') return null;
  const target = /^\(\s*<?([^\s()<>]+)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(source.slice(close + 1));
  if (!target) return null;
  // Solo esquemas seguros: `javascript:`, `data:` o rutas relativas quedan como texto literal.
  if (!SAFE_HREF.test(target[1])) return null;
  const label = parseInline(source.slice(i + 1, close));
  return { node: { kind: 'link', href: target[1], children: label }, end: close + 1 + target[0].length };
}

/** Texto plano de un fragmento (para títulos y extractos). */
export function plainText(nodes: Inline[]): string {
  return nodes.map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : n.kind === 'break' ? ' ' : plainText(n.children))).join('');
}
