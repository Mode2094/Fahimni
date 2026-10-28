import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Classroom from '../components/classroom/Classroom';

// Phase 1 requirement: recognising a question from an image or a recording must
// NEVER request a lesson automatically. The detected text goes into the
// composer for review and editing, and only the student's own send submits it.
function mount() {
  const dom = new JSDOM('<html dir="rtl" lang="ar"><body><div id="root"></div></body></html>', { url: 'https://local' });
  const createdUrls: string[] = [];
  class ObjectUrl {
    static createObjectURL() {
      const value = `blob:mock/${createdUrls.length}`;
      createdUrls.push(value);
      return value;
    }
    static revokeObjectURL() {}
  }
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    sessionStorage: dom.window.sessionStorage,
    URL: ObjectUrl as unknown as typeof URL,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.assign(dom.window, { URL: ObjectUrl as unknown as typeof URL });

  const calls: string[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push(path);
    if (path.includes('/status')) return Response.json({ configured: true, debug: false });
    if (path.includes('/api/vision')) return Response.json({ question: 'أوجد قيمة س عندما 2س + 3 = 7', credits: { balance: 12 } });
    if (path.includes('/api/tutor')) return Response.json({ error: 'يجب ألا يُستدعى تلقائيًا' }, { status: 500 });
    void init;
    return Response.json({ error: 'unexpected' }, { status: 500 });
  }) as typeof fetch;

  const root = createRoot(dom.window.document.getElementById('root')!);
  return {
    dom,
    root,
    calls,
    cleanup: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = oldFetch;
      dom.window.close();
    },
  };
}

async function recognizeImage(dom: JSDOM) {
  const input = dom.window.document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
  const file = new dom.window.File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], 'question.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

test('an image question is recognised into the composer and never auto-submitted', async () => {
  const { dom, root, calls, cleanup } = mount();
  try {
    await act(async () => root.render(React.createElement(Classroom)));

    await recognizeImage(dom);
    // The recognition request finished.
    assert.ok(calls.some((path) => path.includes('/api/vision')), 'vision endpoint was not called');

    const composer = dom.window.document.querySelector('textarea[aria-label="سؤالك للمعلم"]') as HTMLTextAreaElement;
    assert.equal(composer.value, 'أوجد قيمة س عندما 2س + 3 = 7', 'detected text must be placed in the composer for review');

    // No lesson request may happen until the student sends.
    assert.equal(calls.filter((path) => path.includes('/api/tutor')).length, 0, 'a lesson was requested automatically');

    const send = dom.window.document.querySelector('[aria-label="أرسل السؤال"]') as HTMLButtonElement;
    assert.equal(send.disabled, false, 'the send button must be enabled so the student can submit after reviewing');

    // The student reviews and can still edit the recognised text.
    await act(async () => {
      composer.value = 'كم يساوي س؟';
      composer.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(composer.value, 'كم يساوي س؟');

    // Only an explicit send requests the lesson.
    await act(async () => send.click());
    assert.ok(calls.some((path) => path.includes('/api/tutor')), 'explicit send did not request a lesson');
  } finally {
    await cleanup();
  }
});

test('the source never submits a recognised question automatically (regression guard)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const source = await readFile(join(process.cwd(), 'components/classroom/Classroom.tsx'), 'utf8');
  // The auto-submit pattern that shipped before this phase.
  assert.equal(source.includes('ask(result.question'), false, 'recognised text is still auto-submitted');
  assert.ok(source.includes('setDetected(result.question);setQuestion(result.question);resetComposerHeight();'), 'recognised text must be routed to the composer');
});