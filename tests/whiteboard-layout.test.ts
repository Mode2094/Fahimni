import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { BoardObject, BoardState } from '../schemas/lesson';
import { planLayout, rowsFor } from '../lib/whiteboard/layout';
import SmartBoard from '../components/whiteboard/SmartBoard';

function obj(overrides: Partial<BoardObject>): BoardObject {
  return {
    id: 'eq1',
    type: 'write_latex',
    content: 'x = 3',
    region: 'working-area',
    points: [],
    geometry: null,
    color: 'ink',
    highlighted: false,
    focused: false,
    group: null,
    ...overrides,
  };
}

test('a re-used object id yields exactly one board child (regression: eq1 duplicate keys)', () => {
  // The model re-wrote the same equation id, so the board briefly held the old
  // object (erase ghost) and the new one at once.
  const board: BoardState = {
    objects: [
      obj({ id: 'eq1', content: 'x + 2 = 5' }),
      obj({ id: 'eq1', content: 'x = 3' }),
      obj({ id: 'eq2', content: 'y = 4' }),
    ],
  };
  const plan = planLayout({ board, states: new Map(), index: 0, total: 2 });
  const laid = plan.zones.flatMap((zone) => zone.objects);

  // One entry per id, and the newest content wins.
  const ids = laid.map((object) => object.id);
  assert.deepEqual(ids, [...new Set(ids)], 'no duplicate ids reach the renderer');
  assert.equal(ids.length, 2);
  assert.equal(laid.find((object) => object.id === 'eq1')?.content, 'x = 3');

  // The renderer keys rows by their ids; a duplicated row key cannot happen.
  const rowKeys = plan.zones.flatMap((zone) => rowsFor(zone.objects).map((row) => row.map((object) => object.id).join('|')));
  assert.equal(new Set(rowKeys).size, rowKeys.length);
});

test('the board ghost fade never duplicates a live object id', () => {
  // Mirrors SmartBoard's displayBoard composition: live objects plus fading
  // ghosts, minus any ghost whose id is live again.
  const live: BoardState = { objects: [obj({ id: 'eq1', content: 'x = 3' })] };
  const ghosts = [obj({ id: 'eq1', content: 'x + 2 = 5' }), obj({ id: 'h1', content: 'السؤال' })];
  const liveIds = new Set(live.objects.map((object) => object.id));
  const display: BoardState = {
    objects: [...live.objects, ...ghosts.filter((object) => !liveIds.has(object.id))],
  };
  const ids = display.objects.map((object) => object.id);
  assert.deepEqual(ids, ['eq1', 'h1']);
  assert.equal(new Set(ids).size, ids.length);
});

test('rendering a board with a repeated id raises no duplicate-key warning', async () => {
  const dom = new JSDOM('<html dir="rtl" lang="ar"><body><div id="root"></div></body></html>', { url: 'https://local' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    matchMedia: dom.window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number,
    cancelAnimationFrame: (handle: number) => clearTimeout(handle as unknown as NodeJS.Timeout),
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const warnings: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };

  const root = createRoot(document.getElementById('root')!);
  try {
    // The exact reported failure: two board children sharing the id "eq1".
    const board: BoardState = { objects: [obj({ id: 'eq1', content: 'x + 2 = 5' }), obj({ id: 'eq1', content: 'x = 3' })] };
    await act(async () => {
      root.render(React.createElement(SmartBoard as never, { board, onSelect: () => undefined } as never));
    });
    assert.equal(warnings.filter((line) => line.includes('same key')).length, 0);
    // And the surviving node carries the newest content.
    assert.ok(document.body.textContent?.includes('x = 3'));
  } finally {
    await act(async () => root.unmount());
    console.error = originalError;
    dom.window.close();
  }
});