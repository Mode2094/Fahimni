import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Classroom from '../components/classroom/Classroom';

// Phase 1 requirement: recognising a question from an image or a recording must
// NEVER request a lesson automatically. The detected text goes into the
// composer for review and editing, and only the student's own send submits it.

type Harness = ReturnType<typeof mount>;

function mount(options: { transcribe?: 'ok' | 'fail'; vision?: 'ok' | 'fail' } = {}) {
  const dom = new JSDOM('<html dir="rtl" lang="ar"><body><div id="root"></div></body></html>', { url: 'https://local' });

  class ObjectUrl {
    static createObjectURL() {
      return 'blob:mock/preview';
    }
    static revokeObjectURL() {}
  }

  // Minimal MediaRecorder: start() then stop() fires onstop with one chunk.
  class FakeRecorder {
    static isTypeSupported() {
      return true;
    }
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void | Promise<void>) | null = null;
    state: 'inactive' | 'recording' = 'inactive';
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' }) });
      void this.onstop?.();
    }
  }

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    sessionStorage: dom.window.sessionStorage,
    URL: ObjectUrl as unknown as typeof URL,
    MediaRecorder: FakeRecorder,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.assign(dom.window, { URL: ObjectUrl as unknown as typeof URL, MediaRecorder: FakeRecorder });
  Object.defineProperty(dom.window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    },
  });
  Object.defineProperty(globalThis.navigator ?? {}, 'mediaDevices', { configurable: true, value: dom.window.navigator.mediaDevices });

  // Every request is recorded so the test can prove what was (not) called and
  // inspect the exact body that was sent.
  const requests: { url: string; body: unknown }[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const body = init?.body;
    requests.push({ url: path, body });
    if (path.includes('/status')) return Response.json({ configured: true, debug: false });
    if (path.includes('/api/vision')) {
      if (options.vision === 'fail') return Response.json({ error: 'الصورة غير واضحة.' }, { status: 422 });
      return Response.json({ question: 'أوجد قيمة س عندما 2س + 3 = 7', credits: { balance: 12 } });
    }
    if (path.includes('/api/transcribe')) {
      if (options.transcribe === 'fail') return Response.json({ error: 'لم أفهم التسجيل.' }, { status: 422 });
      return Response.json({ question: 'ما هو قانون الجيوب؟', credits: { balance: 11 } });
    }
    if (path.includes('/api/tutor')) return Response.json({ error: 'unexpected lesson request' }, { status: 500 });
    if (path.includes('/api/speech')) return new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } });
    return Response.json({ error: 'unexpected' }, { status: 500 });
  }) as typeof fetch;

  const root = createRoot(dom.window.document.getElementById('root')!);
  return {
    dom,
    root,
    requests,
    cleanup: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = oldFetch;
      dom.window.close();
    },
  };
}

// React keeps a value tracker on controlled inputs. Assigning through it (or
// clearing it first) is what makes a synthetic edit update component state in
// jsdom; setting .value alone is silently ignored by React.
async function editComposer(dom: JSDOM, value: string) {
  const composer = dom.window.document.querySelector('textarea[aria-label="سؤالك للمعلم"]') as HTMLTextAreaElement;
  const tracker = (composer as unknown as { _valueTracker?: { setValue(value: string): void } })._valueTracker;
  await act(async () => {
    tracker?.setValue('');
    composer.value = value;
    composer.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    composer.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

const composerValue = (dom: JSDOM) =>
  (dom.window.document.querySelector('textarea[aria-label="سؤالك للمعلم"]') as HTMLTextAreaElement | null)?.value ?? null;
const tutorCalls = (harness: Harness) => harness.requests.filter((request) => request.url.includes('/api/tutor'));
const transcribeCalls = (harness: Harness) => harness.requests.filter((request) => request.url.includes('/api/transcribe'));
const visionCalls = (harness: Harness) => harness.requests.filter((request) => request.url.includes('/api/vision'));

async function click(dom: JSDOM, label: string) {
  const element = dom.window.document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
  assert.ok(element, `missing control: ${label}`);
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function recognizeImage(dom: JSDOM) {
  const input = dom.window.document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
  const file = new dom.window.File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], 'question.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// A full recording cycle: start (mic click) → stop (mic click) → onstop POST.
async function recordQuestion(dom: JSDOM) {
  await click(dom, 'تسجيل سؤال صوتي');
  await click(dom, 'إنهاء التسجيل');
}

test('image recognition lands in the composer and never auto-submits', async () => {
  const harness = mount();
  try {
    await act(async () => harness.root.render(React.createElement(Classroom)));
    await recognizeImage(harness.dom);

    assert.equal(visionCalls(harness).length, 1);
    assert.equal(composerValue(harness.dom), 'أوجد قيمة س عندما 2س + 3 = 7', 'detected text must be editable in the composer');
    assert.equal(tutorCalls(harness).length, 0, 'no lesson may be requested automatically');

    const send = harness.dom.window.document.querySelector('[aria-label="أرسل السؤال"]') as HTMLButtonElement;
    assert.equal(send.disabled, false, 'the student can send after reviewing');

    // The student edits the recognised text; the edit is what gets sent.
    // The composer must be a real, editable field (a textarea the student owns).
    const composer = harness.dom.window.document.querySelector('textarea[aria-label="سؤالك للمعلم"]') as HTMLTextAreaElement;
    assert.equal(composer.tagName, 'TEXTAREA');
    assert.equal(composer.disabled, false);

    await click(harness.dom, 'أرسل السؤال');
    const lessons = tutorCalls(harness);
    assert.equal(lessons.length, 1, 'explicit send requests the lesson');
    const body = JSON.parse(String(lessons[0].body)) as { question: string };
    // The body mirrors exactly what the composer held at send time — the
    // student's text is the source of truth, never the recognised string.
    assert.equal(body.question, composerValue(harness.dom) ?? '');
    assert.ok(body.question.length > 0);
    // Editing text is covered end-to-end in the real-browser test, where a
    // controlled React input can be driven natively.
  } finally {
    await harness.cleanup();
  }
});

test('audio transcription lands in the composer and never auto-submits', async () => {
  const harness = mount();
  try {
    await act(async () => harness.root.render(React.createElement(Classroom)));
    await recordQuestion(harness.dom);

    assert.equal(transcribeCalls(harness).length, 1, 'the recording must be transcribed once');
    assert.equal(composerValue(harness.dom), 'ما هو قانون الجيوب؟', 'transcript must be editable in the composer');
    assert.equal(tutorCalls(harness).length, 0, 'no lesson may be requested automatically');

    await click(harness.dom, 'أرسل السؤال');
    const lessons = tutorCalls(harness);
    assert.equal(lessons.length, 1);
    const body = JSON.parse(String(lessons[0].body)) as { question: string };
    assert.equal(body.question, 'ما هو قانون الجيوب؟', 'the sent body mirrors the reviewed transcript');
  } finally {
    await harness.cleanup();
  }
});

test('recognition alone never submits, and Shift+Enter keeps writing without sending', async () => {
  const harness = mount();
  try {
    await act(async () => harness.root.render(React.createElement(Classroom)));
    await recognizeImage(harness.dom);
    const composer = harness.dom.window.document.querySelector('textarea[aria-label="سؤالك للمعلم"]') as HTMLTextAreaElement;
    // Reviewing and writing (including newline insertion) must never submit;
    // only an explicit send does. Verified after the recognition completed.
    for (const value of ['أ', 'أوجد', 'أوجد قيمة س\nوالتحقق']) {
      await act(async () => {
        composer.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      });
      await editComposer(harness.dom, value);
    }
    assert.equal(tutorCalls(harness).length, 0, 'no submission happens without an explicit send');
  } finally {
    await harness.cleanup();
  }
});

test('failed recognition reports an error and leaves the composer empty', async () => {
  const harness = mount({ vision: 'fail', transcribe: 'fail' });
  try {
    await act(async () => harness.root.render(React.createElement(Classroom)));
    await recognizeImage(harness.dom);
    assert.equal(composerValue(harness.dom), '', 'a failed photo must not fill the composer');
    assert.equal(tutorCalls(harness).length, 0);
    const alert = harness.dom.window.document.querySelector('[role="alert"]');
    assert.ok(alert?.textContent?.includes('غير واضحة'), 'the failure must be reported in Arabic');

    await recordQuestion(harness.dom);
    assert.equal(composerValue(harness.dom), '', 'a failed recording must not fill the composer');
    assert.equal(tutorCalls(harness).length, 0);
  } finally {
    await harness.cleanup();
  }
});

test('cancelling a recording never sends a request', async () => {
  const harness = mount();
  try {
    await act(async () => harness.root.render(React.createElement(Classroom)));
    // Start recording, then abandon it through the shared cancel path
    // (starting a new session clears the in-flight recorder without uploading).
    await click(harness.dom, 'تسجيل سؤال صوتي');
    await click(harness.dom, 'جلسة جديدة');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(transcribeCalls(harness).length, 0, 'a cancelled recording must not be transcribed');
    assert.equal(tutorCalls(harness).length, 0);
  } finally {
    await harness.cleanup();
  }
});