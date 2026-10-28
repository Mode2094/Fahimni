import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateNumeric, parseSolutions, verifyAnswer, verifySimpleFactors } from '../lib/ai/math-check';

test('safe numeric evaluation handles arithmetic, fractions, powers and roots', () => {
  assert.equal(evaluateNumeric('2 + 3 * 4'), 14);
  assert.equal(evaluateNumeric('(2 + 3) * 4'), 20);
  assert.equal(evaluateNumeric('3/4'), 0.75);
  assert.equal(evaluateNumeric('2^3'), 8);
  assert.equal(evaluateNumeric('sqrt(16)'), 4);
  assert.equal(evaluateNumeric('sqrt 2'), Math.SQRT2);
  assert.equal(evaluateNumeric('2 * pi'), 2 * Math.PI);
  assert.equal(evaluateNumeric('١٠ / ٤'), 2.5);
  assert.equal(evaluateNumeric('2 +'), null);
  assert.equal(evaluateNumeric('sqrt(-1)'), null);
  assert.equal(evaluateNumeric('alert(1)'), null);
  assert.equal(evaluateNumeric('x + 2'), null);
  assert.equal(evaluateNumeric('1/0'), null);
});

test('solution parsing reads signs, fractions, roots and ± notation', () => {
  assert.deepEqual(parseSolutions('س = 2 أو س = 3'), [2, 3]);
  assert.deepEqual(parseSolutions('(س-2)(س-3)'), [2, 3]);
  assert.deepEqual(parseSolutions('س = ±sqrt(2)'), [Math.SQRT2, -Math.SQRT2]);
  assert.deepEqual(parseSolutions('ناقص 5 و 1/2'), [-5, 0.5]);
  assert.equal(parseSolutions('لا يوجد'), null);
});

test('quadratic solution sets accept equivalent orderings and formats', () => {
  const problem = 'حل المعادلة س تربيع ناقص 5س زائد 6 يساوي صفر';
  assert.equal(verifyAnswer(problem, 'س = 3 أو س = 2').verdict, 'correct');
  assert.equal(verifyAnswer(problem, 'س = 2 و س = 3').verdict, 'correct');
  assert.equal(verifyAnswer(problem, '(س-2)(س-3)').verdict, 'correct');
  assert.equal(verifyAnswer(problem, 'س = 2 أو س = 4').verdict, 'incorrect');
  assert.equal(verifyAnswer(problem, 'س = 2').verdict, 'incorrect');
  assert.equal(verifyAnswer(problem, 'س = 1 أو س = 6').verdict, 'incorrect');
});

test('roots, fractions and decimals are compared with tolerance', () => {
  const problem = 'حل المعادلة س تربيع ناقص 2 يساوي صفر';
  assert.equal(verifyAnswer(problem, 'س = sqrt(2) أو س = -sqrt(2)').verdict, 'correct');
  assert.equal(verifyAnswer(problem, 'س = 1.41421 أو س = -1.41421').verdict, 'correct');
  assert.equal(verifyAnswer(problem, 'س = 1.4').verdict, 'incorrect');
  const fraction = 'حل المعادلة 2س يساوي 1';
  assert.equal(verifyAnswer(fraction, 'س = 1/2').verdict, 'correct');
  assert.equal(verifyAnswer(fraction, 'س = 0.5').verdict, 'correct');
});

test('linear equations verify a single correct value', () => {
  const problem = 'حل المعادلة س زائد 3 يساوي 5';
  assert.equal(verifyAnswer(problem, 'س = 2').verdict, 'correct');
  assert.equal(verifyAnswer(problem, 'س = -2').verdict, 'incorrect');
});

test('pure arithmetic answers compare numerically', () => {
  assert.equal(verifyAnswer('2 + 3 * 4 يساوي', '14').verdict, 'correct');
  assert.equal(verifyAnswer('2 + 3 * 4 يساوي', '20').verdict, 'incorrect');
});

test('unverifiable attempts stay unknown and are never graded', () => {
  const problem = 'اشرح فكرة النهاية في التفاضل';
  assert.equal(verifyAnswer(problem, 'أعتقد أنها تعني الاقتراب').verdict, 'unknown');
  assert.equal(verifyAnswer(problem, 'ما هو الجواب؟').verdict, 'unknown');
});

test('the original regression attempt stays deterministically wrong', () => {
  assert.equal(verifySimpleFactors('حلل المقدار س تربيع ناقص 5س زائد 6', 'حاولت: (س-1)(س-6)'), false);
});
