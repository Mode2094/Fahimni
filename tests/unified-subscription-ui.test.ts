import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SubscriptionWidgetCard } from '../components/student/subscription-widget';
import type { SubscriptionWidget } from '../lib/billing/student-view';

// Renders the dashboard widget in a real RTL document and checks the Arabic,
// accessible output for each subscription/credit state. No fabricated data:
// each case uses an explicit widget snapshot.

function render() {
  const dom = new JSDOM('<html dir="rtl" lang="ar"><body><div id="root"></div></body></html>', { url: 'https://local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, self: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  return { dom, root };
}

function snapshot(overrides: Partial<SubscriptionWidget> = {}): SubscriptionWidget {
  return {
    status: 'active',
    semesterName: 'الفصل الأول 2026/2027',
    endsAt: new Date('2027-06-15T20:59:59.999Z'),
    daysRemaining: 40,
    credits: {
      userId: 'u',
      semesterBalance: 120,
      topupBalance: 30,
      semesterGrantedAt: new Date(),
      semesterExpiresAt: new Date('2027-06-15T20:59:59.999Z'),
      updatedAt: new Date(),
      total: 150,
    },
    ...overrides,
  };
}

test('the subscription widget renders Arabic RTL with the active state and unified balance', async () => {
  const { dom, root } = render();
  try {
    await act(async () => root.render(React.createElement(SubscriptionWidgetCard, { widget: snapshot() })));
    const text = dom.window.document.body.textContent ?? '';
    assert.equal(dom.window.document.documentElement.dir, 'rtl');
    assert.match(text, /اشتراك فهمني الفصلي/);
    assert.match(text, /اشتراكك فعّال/);
    assert.match(text, /الرصيد المتاح: 150/);
    assert.match(text, /فصلي: 120/);
    assert.match(text, /مشترى: 30/);
    // Active state offers the top-up action.
    assert.match(text, /شحن رصيد/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('the widget shows a scheduled state and a clear next action when no subscription exists', async () => {
  const { dom, root } = render();
  try {
    await act(async () => root.render(React.createElement(SubscriptionWidgetCard, { widget: snapshot({ status: 'scheduled', credits: { ...snapshot().credits, semesterBalance: 0, topupBalance: 0, total: 0 } }) })));
    let text = dom.window.document.body.textContent ?? '';
    assert.match(text, /يبدأ قريبًا/);
    assert.match(text, /تفاصيل الاشتراك/);

    await act(async () => root.render(React.createElement(SubscriptionWidgetCard, { widget: snapshot({ status: 'none', semesterName: null, endsAt: null, daysRemaining: 0, credits: { ...snapshot().credits, semesterBalance: 0, topupBalance: 0, total: 0 } }) })));
    text = dom.window.document.body.textContent ?? '';
    assert.match(text, /لا يوجد اشتراك/);
    assert.match(text, /لا يوجد فصل متاح لصفك حاليًا/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('the widget presents an expired state honestly', async () => {
  const { dom, root } = render();
  try {
    await act(async () => root.render(React.createElement(SubscriptionWidgetCard, { widget: snapshot({ status: 'expired', daysRemaining: 0 }) })));
    const text = dom.window.document.body.textContent ?? '';
    assert.match(text, /انتهى الاشتراك/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('an exhausted wallet shows a zero balance without inventing credits', async () => {
  const { dom, root } = render();
  try {
    await act(async () => root.render(React.createElement(SubscriptionWidgetCard, { widget: snapshot({ credits: { ...snapshot().credits, semesterBalance: 0, topupBalance: 0, total: 0 } }) })));
    const text = dom.window.document.body.textContent ?? '';
    assert.match(text, /الرصيد المتاح: 0/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
