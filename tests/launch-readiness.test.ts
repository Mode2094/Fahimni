import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paymentReadiness, worst } from '../lib/admin/launch-readiness';
import { isSupportedCheckoutCurrency, SUPPORTED_CHECKOUT_CURRENCIES } from '../lib/freemius/verification';

// The launch-readiness aggregation must never show a fabricated green state:
// payment readiness is blocked whenever the provider link is unhealthy OR the
// offer currency is unsupported (the current JOD situation).

test('payment readiness is blocked for an unsupported currency even when the provider is up', () => {
  const check = paymentReadiness({ providerOk: true, providerCode: 'ok', currency: 'JOD' });
  assert.equal(check.level, 'blocked');
  assert.ok(check.action, 'a precise owner action is required');
  assert.equal(isSupportedCheckoutCurrency('JOD'), false, 'Freemius does not support JOD today');
  assert.equal((SUPPORTED_CHECKOUT_CURRENCIES as readonly string[]).includes('JOD'), false);
});

test('payment readiness is blocked when the provider connection fails', () => {
  const check = paymentReadiness({ providerOk: false, providerCode: 'auth_failed', currency: 'USD' });
  assert.equal(check.level, 'blocked');
  assert.ok(check.action);
});

test('payment readiness is ok only with a healthy provider and a supported currency', () => {
  const check = paymentReadiness({ providerOk: true, providerCode: 'ok', currency: 'USD' });
  assert.equal(check.level, 'ok');
  assert.equal(check.action, undefined);
  assert.equal(isSupportedCheckoutCurrency('usd'), true, 'currency matching is case-insensitive');
});

test('worst() escalates to the most severe level', () => {
  assert.equal(worst(['ok', 'ok']), 'ok');
  assert.equal(worst(['ok', 'warn']), 'warn');
  assert.equal(worst(['warn', 'unknown']), 'warn');
  assert.equal(worst(['warn', 'blocked']), 'blocked');
  assert.equal(worst([]), 'ok');
});
