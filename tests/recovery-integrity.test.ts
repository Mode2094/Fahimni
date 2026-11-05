import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionSchema, emptyBoard, type Action } from '../schemas/lesson';
import { validateActions } from '../lib/whiteboard/engine';

const action = (overrides: Partial<Action>): Action => ({
  type: 'write_latex', id: 'expression', content: 'x=1',
  region: 'working-area', targets: [], points: [], color: 'ink',
  geometry: null, delayMs: 0, ...overrides,
});

function validate(candidate: Action) {
  // Exercise the same JSON and schema boundary used by generated lessons.
  const parsed = actionSchema.parse(JSON.parse(JSON.stringify(candidate)));
  return validateActions(emptyBoard(), [{ actions: [parsed] }], []);
}

test('canonical unit-circle formulas retain exact Unicode and backslashes across JSON and board validation', () => {
  const formulas = [
    String.raw`P=(r\cos\theta,\;r\sin\theta)`,
    String.raw`\sin\theta=0.8`,
    String.raw`\cos\theta=-0.6`,
    String.raw`\tan\theta=-\frac{4}{3}`,
    String.raw`\theta\in(\frac{\pi}{2},\pi)`,
  ];
  for (const content of formulas) {
    const board = validate(action({ content }));
    assert.equal(board.objects[0].content, content);
    assert.deepEqual([...board.objects[0].content].map(c => c.codePointAt(0)), [...content].map(c => c.codePointAt(0)));
  }
});

// These strings are legal JSON and may be accepted by a TeX parser as ordinary
// letters/whitespace. They are nevertheless corrupted mathematics and must not
// reach a student's board. Reject rather than guessing the original formula.
for (const [name, content] of [
  ['JSON tab replacing the start of theta', JSON.parse('"\\theta"') as string],
  ['JSON form feed replacing the start of frac', JSON.parse('"\\frac{4}{3}"') as string],
  ['JSON carriage return replacing the start of right', JSON.parse('"\\right)"') as string],
  ['mojibake punctuation from screenshot', 'x â€ = 1'],
  ['mojibake Greek theta', 'sin(Î¸)=0.8'],
  ['Unicode replacement character', 'sin(\uFFFD)=0.8'],
  ['actual-provider stray Thai character in a coordinate', 'P(-0.6, ญ0.8)'],
  ['actual-provider invisible right-to-left marks inside math', 'P(x,y)=P(\u200f\u200fcosθ,sinθ)'],
  ['unknown mathematical command', String.raw`\invalidMathCommand{x}`],
] as const) {
  test(`generated math rejects ${name}`, () => {
    assert.throws(() => validate(action({ content })));
  });
}

test('graph circles without defined geometry are rejected instead of silently disappearing', () => {
  assert.throws(() => validate(action({ type: 'draw_circle', id: 'circle', content: null, region: 'graph-area' })));
});

test('graph line and arrow need two endpoints instead of silently disappearing', () => {
  for (const type of ['draw_line', 'draw_arrow'] as const) {
    for (const points of [[], [{ x: 0, y: 0 }]]) {
      assert.throws(() => validate(action({ type, id: 'radius', content: null, region: 'graph-area', points })));
    }
  }
});

test('graph polylines need at least two points', () => {
  for (const type of ['plot_points', 'plot_graph'] as const) {
    assert.throws(() => validate(action({ type, id: 'curve', content: null, region: 'graph-area', points: [{ x: 0, y: 0 }] })));
  }
});

test('valid graph radius preserves the actual unit-circle point in quadrant II', () => {
  const point = { x: -0.6, y: 0.8 };
  const board = validate(action({ type: 'draw_line', id: 'radius', content: null, region: 'graph-area', points: [{ x: 0, y: 0 }, point] }));
  assert.deepEqual(board.objects[0].points[1], point);
  assert.equal(point.x ** 2 + point.y ** 2, 1);
  assert.ok(Math.abs(point.y / point.x - (-4 / 3)) < Number.EPSILON * 2);
});
