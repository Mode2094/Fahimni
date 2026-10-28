import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toSpokenArabic } from '../lib/ai/spoken-math';

const NO_LATEX = /[\\^_{}$]/;

test('spoken Arabic never contains LaTeX syntax', () => {
  const cases = [
    'x^4 - 3x^2 + 2 = 0',
    '\\frac{a}{b}',
    '\\sqrt{2}',
    '\\sqrt[3]{x}',
    'x^{12} + y_{1}',
    '\\sin \\theta = \\frac{\\text{opposite}}{\\text{hypotenuse}}',
    '2 \\times 3 \\div 6 \\pm 1',
    'x \\le 5 \\ge y \\neq 0',
    '\\pi r^2',
  ];
  for (const input of cases) {
    const spoken = toSpokenArabic(input);
    assert.equal(NO_LATEX.test(spoken), false, `residual LaTeX in: ${spoken}`);
    assert.equal(spoken.includes('frac'), false, spoken);
    assert.equal(spoken.includes('sqrt'), false, spoken);
    assert.equal(spoken.includes('text'), false, spoken);
  }
});

test('fractions, roots, powers and operators become natural Arabic words', () => {
  assert.equal(toSpokenArabic('\\frac{1}{2}'), '1 على 2');
  assert.equal(toSpokenArabic('\\sqrt{2}'), 'جذر 2');
  assert.equal(toSpokenArabic('\\sqrt[3]{8}'), 'الجذر ثلاثة لـ 8');
  assert.equal(toSpokenArabic('x^2'), 'إكس تربيع');
  assert.equal(toSpokenArabic('x^3'), 'إكس تكعيب');
  assert.equal(toSpokenArabic('x^4'), 'إكس أس 4');
  assert.equal(toSpokenArabic('x^4 - 3x^2 + 2 = 0'), 'إكس أس 4 ناقص 3 إكس تربيع زائد 2 يساوي 0');
  assert.equal(toSpokenArabic('x_{1}'), 'إكس واحد');
  assert.equal(toSpokenArabic('a \\times b'), 'أ ضرب ب');
  assert.equal(toSpokenArabic('x \\le 5'), 'إكس أصغر من أو يساوي 5');
  assert.equal(toSpokenArabic('\\pi r^2'), 'باي راء تربيع');
  assert.equal(toSpokenArabic('\\theta'), 'ثيتا');
});

test('pure Arabic text passes through untouched', () => {
  const arabic = 'نحلل المعادلة إلى عوامل ثم نجد الحلول.';
  assert.equal(toSpokenArabic(arabic), arabic);
  assert.equal(toSpokenArabic(''), '');
  assert.equal(toSpokenArabic('   '), '');
});

test('the recorded equation is spoken naturally with the correct math kept intact', () => {
  const spoken = toSpokenArabic('x^4 - 3x^2 + 2 = 0');
  assert.ok(spoken.includes('إكس'));
  assert.ok(spoken.includes('أس 4'));
  assert.ok(spoken.includes('تربيع'));
  assert.ok(spoken.includes('ناقص'));
  assert.ok(spoken.includes('يساوي 0'));
  assert.equal(NO_LATEX.test(spoken), false);
});
