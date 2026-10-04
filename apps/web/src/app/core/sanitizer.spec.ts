import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMarkdown } from './sanitizer.ts';

test('sanitizeMarkdown strips script tags', () => {
  const dirty = 'El ápeiron es ilimitado <script>alert("xss")</script> y eterno.';
  const clean = sanitizeMarkdown(dirty);
  assert.equal(clean, 'El ápeiron es ilimitado  y eterno.');
});

test('sanitizeMarkdown strips inline event handlers and javascript links', () => {
  const dirty = '<img src="x" onerror="alert(1)"> [click](javascript:alert(1))';
  const clean = sanitizeMarkdown(dirty);
  assert.ok(!clean.includes('onerror='));
  assert.ok(!clean.includes('javascript:'));
});

test('sanitizeMarkdown preserves valid Markdown and LaTeX math', () => {
  const input = 'Equilibrio: $P \\rightarrow Q$ y \\(x^2 + y^2 = z^2\\)';
  assert.equal(sanitizeMarkdown(input), input);
});
