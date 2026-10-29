import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Classroom from '../components/classroom/Classroom';

function mountClassroom() {
  const dom = new JSDOM('<html dir="rtl" lang="ar"><body><div id="root"></div></body></html>', { url: 'https://local' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('/status')
      ? Response.json({ configured: false, debug: false })
      : Response.json({ error: 'المعلّم غير متصل بعد.' }, { status: 503 });

  const root = createRoot(dom.window.document.getElementById('root')!);
  return {
    dom,
    root,
    cleanup: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = oldFetch;
      dom.window.close();
    },
  };
}

const byLabel = (label: string) => globalThis.document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const byText = (root: Element, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

test('classroom exposes the primary toolbar and the shared tools panel on every viewport', async () => {
  const { root, cleanup } = mountClassroom();
  try {
    await act(async () => root.render(React.createElement(Classroom)));

    // primary tools are always directly available
    for (const label of ['الخطوة السابقة', 'تشغيل', 'الخطوة التالية', 'تسجيل سؤال صوتي', 'تصوير المسألة', 'رفع صورة', 'أرسل السؤال', 'ملء الشاشة', 'أدوات الشرح']) {
      assert.ok(byLabel(label), `missing primary control: ${label}`);
    }
    assert.ok(globalThis.document.querySelector('.board-tools'), 'zoom/fullscreen group missing');
    assert.ok(globalThis.document.querySelector('textarea[aria-label="سؤالك للمعلم"]'), 'composer missing');

    // the shared tools panel opens from the desktop tools button
    await act(async () => byLabel('أدوات الشرح')!.click());
    const dialog = globalThis.document.querySelector('[role="dialog"][aria-label="أدوات الشرح"]');
    assert.ok(dialog, 'tools dialog missing');

    // shared action inventory lives in the one panel used by desktop and mobile
    for (const label of ['رحلة الحل', 'أعد الخطوة', 'أعد من البداية', 'أوقف الشرح', 'مسح السبورة', 'تكبير الكتابة', 'تصغير الكتابة', 'رفع صورة', 'سؤال صوتي', 'جلسة جديدة', 'ملء الشاشة']) {
      assert.ok(byText(dialog!, label), `missing tools-panel action: ${label}`);
    }
    assert.ok(dialog!.querySelector('select[aria-label="سرعة الشرح"]'), 'speed control missing');

    // disabled-without-a-lesson is explicit, not a missing action
    assert.equal((byText(dialog!, 'أعد الخطوة') as HTMLButtonElement).disabled, true);
    assert.equal((byText(dialog!, 'تكبير الكتابة') as HTMLButtonElement).disabled, false);

    await act(async () => (byLabel('إغلاق أدوات الشرح') as HTMLElement).click());
    assert.equal(globalThis.document.querySelector('[role="dialog"]'), null);
  } finally {
    await cleanup();
  }
});

test('fullscreen covers the whole classroom and preserves lesson state on exit', async () => {
  const { dom, root, cleanup } = mountClassroom();
  const fullscreenCalls: Element[] = [];
  let exitCalls = 0;
  let fullscreenElement: Element | null = null;
  try {
    Object.defineProperty(dom.window.Element.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value(this: Element) {
        fullscreenCalls.push(this);
        return Promise.resolve();
      },
    });
    Object.defineProperty(globalThis.document, 'exitFullscreen', {
      configurable: true,
      value: async () => {
        exitCalls += 1;
      },
    });
    Object.defineProperty(globalThis.document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    await act(async () => root.render(React.createElement(Classroom)));

    // toggle a real stateful control (teacher voice) so we can prove it survives
    const voiceButton = globalThis.document.querySelector('.narration-bar [aria-label]') as HTMLElement;
    const voiceBefore = voiceButton.getAttribute('aria-label');
    await act(async () => voiceButton.click());
    const voiceAfter = voiceButton.getAttribute('aria-label');
    assert.notEqual(voiceAfter, voiceBefore, 'voice toggle did not change state');

    // open the shared tools panel: its open state must survive the cycle
    await act(async () => byLabel('أدوات الشرح')!.click());
    assert.ok(globalThis.document.querySelector('[role="dialog"][aria-label="أدوات الشرح"]'));

    // enter fullscreen: the API must target the classroom wrapper (not the board)
    await act(async () => {
      (globalThis.document.querySelector('.board-tools [aria-label="ملء الشاشة"]') as HTMLElement).click();
    });
    assert.equal(fullscreenCalls.length, 1);
    assert.equal(fullscreenCalls[0], globalThis.document.querySelector('.classroom'));
    assert.ok(globalThis.document.querySelector('.classroom')!.classList.contains('is-immersive'));
    assert.ok(globalThis.document.querySelector('[role="dialog"][aria-label="أدوات الشرح"]'), 'tools panel state lost on fullscreen entry');
    assert.equal(
      (globalThis.document.querySelector('.narration-bar [aria-label]') as HTMLElement).getAttribute('aria-label'),
      voiceAfter,
      'playback state lost on fullscreen entry',
    );

    // in fullscreen, playback, composer and the tools menu are all still there
    assert.ok(byLabel('الخطوة السابقة') && byLabel('تشغيل') && byLabel('الخطوة التالية'), 'playback missing in fullscreen');
    assert.ok(globalThis.document.querySelector('textarea[aria-label="سؤالك للمعلم"]'), 'composer missing in fullscreen');
    await act(async () => (byLabel('إغلاق أدوات الشرح') as HTMLElement).click());

    // exit through the same control; the lesson state must survive
    fullscreenElement = globalThis.document.querySelector('.classroom');
    await act(async () => {
      (globalThis.document.querySelector('.board-tools [aria-label="إنهاء وضع الصف"]') as HTMLElement).click();
    });
    assert.equal(exitCalls, 1);
    assert.equal(
      (globalThis.document.querySelector('.narration-bar [aria-label]') as HTMLElement).getAttribute('aria-label'),
      voiceAfter,
      'playback state lost on fullscreen exit',
    );

    fullscreenElement = null;
    await act(async () => globalThis.document.dispatchEvent(new dom.window.Event('fullscreenchange')));
    assert.equal(globalThis.document.querySelector('.classroom')!.classList.contains('is-immersive'), false);
  } finally {
    await cleanup();
  }
});
