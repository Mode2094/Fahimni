import { test } from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';

import { actionSchema, generatedLessonSchema, emptyBoard, type Lesson, type Segment } from '../schemas/lesson';
import { runActions, validateActions } from '../lib/whiteboard/engine';
import { SUBJECT_PRESETS } from '../lib/whiteboard/presets';
import { FIXTURE_LESSONS, FIXTURE_KEYS } from '../lib/whiteboard/fixtures-subjects';
import {
  GRAPH_MAX,
  GRAPH_MIN,
  arrowHeadPath,
  axisTicks,
  clampGraphPoint,
  graphToSvg,
  isGraphPoint,
  orderLine,
  polylinePath,
  segmentPath,
  SVG_PAD,
  SVG_SIZE,
} from '../lib/whiteboard/graph';

test('graph coordinates map into the SVG viewBox and clamp out-of-range input', () => {
  const topLeft = graphToSvg({ x: GRAPH_MIN, y: GRAPH_MAX });
  assert.equal(topLeft.x, SVG_PAD);
  assert.equal(topLeft.y, SVG_PAD);
  const bottomRight = graphToSvg({ x: GRAPH_MAX, y: GRAPH_MIN });
  assert.equal(bottomRight.x, SVG_SIZE - SVG_PAD);
  assert.equal(bottomRight.y, SVG_SIZE - SVG_PAD);
  const origin = graphToSvg({ x: 0, y: 0 });
  assert.ok(Math.abs(origin.x - SVG_SIZE / 2) < 0.01);
  assert.ok(Math.abs(origin.y - SVG_SIZE / 2) < 0.01);
  assert.deepEqual(clampGraphPoint({ x: 99, y: -99 }), { x: GRAPH_MAX, y: GRAPH_MIN });
  assert.equal(isGraphPoint({ x: 5, y: 5 }), true);
  assert.equal(isGraphPoint({ x: 11, y: 0 }), false);
  assert.equal(isGraphPoint({ x: Number.NaN, y: 0 }), false);
});

test('plotted lines are ordered by x and every path is finite', () => {
  const ordered = orderLine([{ x: 3, y: 1 }, { x: -2, y: 4 }, { x: 0, y: 0 }]);
  assert.deepEqual(ordered.map((p) => p.x), [-2, 0, 3]);
  const path = polylinePath(ordered);
  assert.ok(path.startsWith('M '));
  assert.equal(path.includes('NaN'), false);
  assert.equal(segmentPath({ x: -1, y: -1 }, { x: 1, y: 1 }).includes('NaN'), false);
  assert.equal(arrowHeadPath({ x: 0, y: 0 }, { x: 5, y: 5 }).includes('NaN'), false);
  assert.equal(polylinePath([{ x: 0, y: 0 }]), '');
  assert.deepEqual(axisTicks(5), [-10, -5, 0, 5, 10]);
});

test('every subject preset produces strictly valid, renderable actions', () => {
  for (const [key, build] of Object.entries(SUBJECT_PRESETS)) {
    const actions = build();
    assert.ok(actions.length >= 5, `${key} has enough actions`);
    for (const action of actions) {
      const parsed = actionSchema.safeParse(action);
      assert.equal(parsed.success, true, `${key}/${action.type}: ${parsed.success ? '' : parsed.error.message}`);
      for (const point of action.points) assert.equal(isGraphPoint(point), true, `${key}/${action.id} point in range`);
      if (action.type === 'write_latex' && action.content) {
        assert.doesNotThrow(() => katex.renderToString(action.content as string, { throwOnError: true, trust: false }), `${key}/${action.id} katex`);
      }
    }
    const board = runActions(emptyBoard(), actions);
    assert.ok(board.objects.length >= 4, `${key} draws objects`);
    // Re-applying the same actions to a fresh board must stay deterministic.
    const again = runActions(emptyBoard(), actions);
    assert.deepEqual(again.objects.map((o) => o.id), board.objects.map((o) => o.id));
  }
});

test('fixtures for bookless subjects are labelled and pass the real server schema', () => {
  assert.deepEqual(FIXTURE_KEYS.sort(), ['arabic', 'chemistry', 'geometry', 'history', 'physics']);
  for (const [key, lesson] of Object.entries(FIXTURE_LESSONS)) {
    assert.ok(lesson.title.startsWith('عرض تجريبي'), `${key} is clearly labelled`);
    const payload = {
      title: lesson.title,
      mode: lesson.mode,
      sufficientContext: lesson.sufficientContext,assessment: lesson.assessment,
      message: lesson.message,
      segments: lesson.segments.map((s: Segment) => ({ id: s.id, narration: s.narration, goal: s.goal, sourceChunkIds: s.sourceChunkIds, actions: s.actions })),
    };
    const parsed = generatedLessonSchema.safeParse(payload);
    assert.equal(parsed.success, true, `${key}: ${parsed.success ? '' : parsed.error.message}`);
    if (parsed.success) validateActions(emptyBoard(), parsed.data.segments as Segment[], []);
    // Fixture narration must already be TTS-safe Arabic without LaTeX.
    for (const segment of lesson.segments) {
      assert.equal(/[\\^_{}$]/.test(segment.narration), false, `${key} narration`);
    }
  }
});

test('fixture lessons never leak into production routing helpers', () => {
  // The classroom only loads fixtures behind an explicit dev-only query flag;
  // this test pins the fixture contract that makes that safe: labelled titles
  // and the shared marker message.
  for (const lesson of Object.values(FIXTURE_LESSONS) as Lesson[]) {
    assert.ok(lesson.message.includes('تجريبي'));
    assert.equal(lesson.mode, 'new');
  }
});
