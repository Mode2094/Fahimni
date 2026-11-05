import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { emptyBoard, type Action, type Lesson } from '../schemas/lesson';
import { runActions } from '../lib/whiteboard/engine';
import { usePlayback, type LessonCheckpoint } from '../lib/whiteboard/usePlayback';
import { readLessonDraft, lessonDraftKey } from '../lib/whiteboard/session-draft';
import { circleFromPoints, sceneExtent, worldToScene } from '../lib/whiteboard/scene';

const write = (id: string, content: string): Action => ({
  type: 'write_latex', id, content, region: 'working-area', targets: [],
  points: [], geometry: null, color: 'ink', delayMs: 0,
});
const source = { chunkId: 'fixture-source', sourceId: 'fixture-book', pdfPage: 1, printedPage: 1, lesson: 'اختبار العرض', image: '/book/1.jpg' };
const lesson: Lesson = {
  id: 'checkpoint-original', title: 'حل معادلة', question: 'حل المعادلة', mode: 'new',
  sufficientContext: true, assessment: null, message: '', sources: [source],
  segments: [
    { id: 'first', goal: 'نكتب المعادلة', narration: 'نكتب المعادلة الأصلية.', sources: [source], sourceChunkIds: [source.chunkId], actions: [write('original', '2x+4=10')] },
    { id: 'second', goal: 'نطرح ونقسم', narration: 'نطرح أربعة من الطرفين ثم نقسم على اثنين.', sources: [source], sourceChunkIds: [source.chunkId], actions: [write('subtract', '2x=6'), write('answer', 'x=3')] },
  ],
};

test('paused checkpoint restores exact board, step and progress after an intervening follow-up', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let playback!: ReturnType<typeof usePlayback>;
  function Harness() { playback = usePlayback(); return React.createElement('div', null, playback.status); }
  const root = createRoot(document.getElementById('root')!);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => playback.setVoice(false));
    await act(async () => playback.load(lesson, emptyBoard()));
    await settle();
    await act(async () => playback.jump(1));
    await settle();
    await act(async () => playback.halt());
    const checkpoint = playback.checkpoint()!;
    assert.equal(checkpoint.index, 1);
    assert.equal(checkpoint.actionIndex, 1, 'interrupt after the subtraction, before the answer');
    assert.ok(checkpoint.elapsed > 0);
    assert.deepEqual(checkpoint.board.objects.map(object => object.id), ['original', 'subtract']);
    assert.deepEqual(checkpoint.base, emptyBoard());

    const followup: Lesson = {
      ...lesson, id: 'checkpoint-followup', mode: 'followup',
      segments: [{ ...lesson.segments[0], id: 'why', actions: [write('followup-only', '10-4=6')] }],
    };
    await act(async () => playback.load(followup, playback.board));
    await settle();
    assert.ok(playback.board.objects.some(object => object.id === 'followup-only'));

    await act(async () => playback.restore(checkpoint));
    await act(async () => playback.halt());
    assert.equal(playback.lesson?.id, lesson.id);
    assert.equal(playback.index, 1);
    assert.deepEqual(playback.board, checkpoint.board, 'no follow-up objects contaminate restored lesson');
    await settle();
    assert.deepEqual(playback.board, checkpoint.board, 'paused restoration cannot advance drawings');

    await act(async () => playback.toggle());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2000)); });
    await act(async () => playback.halt());
    assert.deepEqual(playback.board.objects.map(object => object.id), ['original', 'subtract', 'answer']);
    assert.equal(playback.board.objects.find(object => object.id === 'answer')?.content, 'x=3');
    assert.equal(new Set(playback.board.objects.map(object => object.id)).size, 3);
    assert.deepEqual(playback.checkpoint()?.base, checkpoint.base, 'restore preserves the original reconstruction base');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

function draft(): LessonCheckpoint {
  return {
    lesson: structuredClone(lesson), index: 1, base: emptyBoard(),
    board: runActions(emptyBoard(), [lesson.segments[0].actions[0], lesson.segments[1].actions[0]]),
    elapsed: 100, actionIndex: 1,
  };
}

test('session draft roundtrip preserves a validated interrupted lesson', () => {
  const expected = draft();
  assert.deepEqual(readLessonDraft(JSON.stringify(expected)), expected);
  assert.notEqual(lessonDraftKey('student-a', 'math'), lessonDraftKey('student-b', 'math'));
  assert.notEqual(lessonDraftKey('student-a', 'math'), lessonDraftKey('student-a', 'physics'));
});

test('session draft rejects corrupted math in lesson actions', () => {
  const value = draft();
  value.lesson.segments[0].actions[0].content = '\t' + 'heta=1';
  assert.equal(readLessonDraft(JSON.stringify(value)), null);
});

test('session draft rejects corrupted math in the restored board snapshot', () => {
  const value = draft();
  value.board.objects[0].content = 'sin(Î¸)=0.8';
  assert.equal(readLessonDraft(JSON.stringify(value)), null);
});

test('session draft rejects corrupted math in a follow-up reconstruction base', () => {
  const value = draft();
  value.lesson.mode = 'followup';
  value.base = runActions(emptyBoard(), [write('old-equation', 'x=\uFFFD')]);
  assert.equal(readLessonDraft(JSON.stringify(value)), null);
});

test('session draft rejects invalid elapsed time, action position and step', () => {
  for (const change of [
    { elapsed: -1 }, { elapsed: 600001 }, { elapsed: null },
    { actionIndex: -1 }, { actionIndex: 0.5 }, { actionIndex: 3 },
    { index: -1 }, { index: 2 }, { index: 0.5 },
  ]) assert.equal(readLessonDraft(JSON.stringify({ ...draft(), ...change })), null, JSON.stringify(change));
  assert.equal(readLessonDraft(null), null);
  assert.equal(readLessonDraft('{'), null);
  assert.equal(readLessonDraft('x'.repeat(500001)), null);
});

test('unit circle scene uses equal horizontal and vertical scales and places P in quadrant II', () => {
  const circle = { type: 'draw_circle' as const, region: 'graph-area' as const, geometry: null, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
  const extent = sceneExtent([circle]);
  assert.equal(extent, 1.25, 'a radius-one circle fills a useful part of the square scene');
  assert.deepEqual(circleFromPoints(circle.points), { center: { x: 0, y: 0 }, radius: 1 });
  const origin = worldToScene({ x: 0, y: 0 }, extent);
  const east = worldToScene({ x: 1, y: 0 }, extent);
  const north = worldToScene({ x: 0, y: 1 }, extent);
  assert.equal(east.x - origin.x, origin.y - north.y, 'a mathematical circle cannot become an ellipse');
  const p = worldToScene({ x: -0.6, y: 0.8 }, extent);
  assert.ok(p.x < origin.x && p.y < origin.y, 'negative x, positive y maps above-left of origin');
  assert.ok(Math.abs((p.x - origin.x) / (east.x - origin.x) + 0.6) < 1e-12);
  assert.ok(Math.abs((origin.y - p.y) / (origin.y - north.y) - 0.8) < 1e-12);
});

test('scene extent includes off-center circle radius and distant lesson objects before playback', () => {
  const shapes = [
    { type: 'draw_circle' as const, region: 'graph-area' as const, geometry: null, points: [{ x: 2, y: -1 }, { x: 4, y: -1 }] },
    { type: 'plot_point' as const, region: 'graph-area' as const, geometry: null, points: [{ x: -6, y: 0 }] },
  ];
  const extent = sceneExtent(shapes);
  assert.equal(extent, 7.5);
  for (const point of [{ x: 4, y: -1 }, { x: 2, y: -3 }, { x: -6, y: 0 }]) {
    const scene = worldToScene(point, extent);
    assert.ok(scene.x > 0 && scene.x < 100 && scene.y > 0 && scene.y < 100);
  }
});
