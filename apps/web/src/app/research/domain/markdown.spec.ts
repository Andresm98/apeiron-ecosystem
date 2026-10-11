import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type Block, type Inline, parseInline, parseMarkdown, plainText } from './markdown.ts';

const text = (t: string): Inline => ({ kind: 'text', text: t });

test('títulos, párrafos y separadores', () => {
  const blocks = parseMarkdown('## Tesis\nEl ápeiron es\nindeterminado.\n\n---\n# Fin #');
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'paragraph', 'rule', 'heading']);
  assert.deepEqual(blocks[0], { kind: 'heading', level: 2, children: [text('Tesis')] });
  // Un salto de línea dentro de un párrafo se respeta, como lo escriben los modelos.
  assert.deepEqual((blocks[1] as { children: Inline[] }).children, [text('El ápeiron es'), { kind: 'break' }, text('indeterminado.')]);
  assert.deepEqual(blocks[3], { kind: 'heading', level: 1, children: [text('Fin')] });
});

test('énfasis, código y tachado; los delimitadores sueltos quedan como texto', () => {
  assert.deepEqual(parseInline('**fuerte** y *suave* y ~~no~~ y `x*y`'), [
    { kind: 'strong', children: [text('fuerte')] }, text(' y '),
    { kind: 'em', children: [text('suave')] }, text(' y '),
    { kind: 'del', children: [text('no')] }, text(' y '),
    { kind: 'code', text: 'x*y' },
  ]);
  assert.deepEqual(parseInline('**anidado *dentro***'), [
    { kind: 'strong', children: [text('anidado '), { kind: 'em', children: [text('dentro')] }] },
  ]);
  assert.deepEqual(parseInline('2 * 3 * 4 y snake_case_name y **abierto'), [text('2 * 3 * 4 y snake_case_name y **abierto')]);
  assert.deepEqual(parseInline('\\*literal\\*'), [text('*literal*')]);
});

test('enlaces: solo http(s) y mailto; el resto queda como texto', () => {
  assert.deepEqual(parseInline('[doi](https://doi.org/10.1/x)'), [
    { kind: 'link', href: 'https://doi.org/10.1/x', children: [text('doi')] },
  ]);
  assert.deepEqual(parseInline('[clic](javascript:alert(1))'), [text('[clic](javascript:alert(1))')]);
  assert.deepEqual(parseInline('[img](data:text/html,x)'), [text('[img](data:text/html,x)')]);
  assert.deepEqual(parseInline('Ver https://arxiv.org/abs/1234.5678.'), [
    text('Ver '), { kind: 'link', href: 'https://arxiv.org/abs/1234.5678', children: [text('https://arxiv.org/abs/1234.5678')] }, text('.'),
  ]);
  assert.deepEqual(parseInline('<mailto:a@b.c>')[0], { kind: 'link', href: 'mailto:a@b.c', children: [text('mailto:a@b.c')] });
});

test('el HTML del modelo nunca es HTML: queda como texto', () => {
  const blocks = parseMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
  assert.equal(blocks.length, 1);
  assert.equal(plainText((blocks[0] as { children: Inline[] }).children), '<script>alert(1)</script> <img src=x onerror=alert(1)>');
});

test('listas ordenadas, con viñetas y anidadas', () => {
  const [list] = parseMarkdown('3. uno\n4. dos\n   - a\n   - b\n5. tres') as [Extract<Block, { kind: 'list' }>];
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[1].map((b) => b.kind), ['paragraph', 'list']);
  const nested = list.items[1][1] as Extract<Block, { kind: 'list' }>;
  assert.equal(nested.ordered, false);
  assert.equal(nested.items.length, 2);
  // Una lista con viñetas tras un párrafo lo interrumpe (GFM).
  assert.deepEqual(parseMarkdown('Puntos:\n- a\n- b').map((b) => b.kind), ['paragraph', 'list']);
});

test('código cercado, incluso sin cerrar', () => {
  assert.deepEqual(parseMarkdown('```python\nprint("**no**")\n```\ndespués'), [
    { kind: 'code', lang: 'python', text: 'print("**no**")' },
    { kind: 'paragraph', children: [text('después')] },
  ]);
  assert.deepEqual(parseMarkdown('~~~\nsin cierre'), [{ kind: 'code', lang: '', text: 'sin cierre' }]);
});

test('citas con bloques dentro', () => {
  const [quote] = parseMarkdown('> **Heráclito**\n> - todo fluye') as [Extract<Block, { kind: 'quote' }>];
  assert.deepEqual(quote.children.map((b) => b.kind), ['paragraph', 'list']);
});

test('tablas GFM con alineación y celdas escapadas', () => {
  const [table] = parseMarkdown('| Agente | Tesis |\n|:--|--:|\n| Feynman | mide \\| prueba |\n| Epicuro |') as [Extract<Block, { kind: 'table' }>];
  assert.equal(table.kind, 'table');
  assert.deepEqual(table.align, ['left', 'right']);
  assert.deepEqual(table.rows[0][1], [text('mide | prueba')]);
  assert.deepEqual(table.rows[1][1], []); // fila corta: celda vacía
  // Sin delimitador no es tabla.
  assert.equal(parseMarkdown('a | b\nc | d')[0].kind, 'paragraph');
});

test('texto vacío y CRLF', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('# A\r\n\r\nb').map((b) => b.kind), ['heading', 'paragraph']);
});
