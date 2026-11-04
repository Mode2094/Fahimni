import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paymentReadiness, worst } from '../lib/admin/launch-readiness';
import { isSupportedCheckoutCurrency, SUPPORTED_CHECKOUT_CURRENCIES } from '../lib/freemius/verification';

// Launch-readiness aggregation must never show a fabricated green state:
// payment readiness requires a VERIFIED plan mapping (price, currency, cycle,
// exact plan id), not merely a healthy provider connection.

const verifiedMapping = { planId: 'plan_x', currency: 'USD', priceMinor: 29_000, billingCycle: 'oneoff', verified: true };

test('payment is blocked for an unsupported currency even when the provider is up', () => {
  const check = paymentReadiness({ providerOk: true, providerCode: 'ok', currency: 'JOD', planId: 'plan_x', mapping: { ...verifiedMapping, currency: 'JOD' }, expectedPriceMinor: 29_000 });
  assert.equal(check.level, 'blocked');
  assert.ok(check.action);
  assert.equal(isSupportedCheckoutCurrency('JOD'), false, 'Freemius does not support JOD today');
  assert.equal((SUPPORTED_CHECKOUT_CURRENCIES as readonly string[]).includes('JOD'), false);
});

test('payment is blocked when the provider connection fails', () => {
  const check = paymentReadiness({ providerOk: false, providerCode: 'auth_failed', currency: 'USD', planId: 'plan_x', mapping: verifiedMapping, expectedPriceMinor: 29_000 });
  assert.equal(check.level, 'blocked');
  assert.ok(check.action);
});

test('payment is blocked without a verified mapping, even with a healthy connection', () => {
  const missing = paymentReadiness({ providerOk: true, providerCode: 'ok', currency: 'USD', planId: 'plan_x', mapping: null, expectedPriceMinor: 29_000 });
  assert.equal(missing.level, 'blocked', 'a healthy connection without a verified mapping is not ready');
  const unverified = paymentReadiness({ providerOk: true, providerCode: 'ok', currency: 'USD', planId: 'plan_x', mapping: { ...verifiedMapping, verified: false }, expectedPriceMinor: 29_000 });
  assert.equal(unverified.level, 'blocked', 'an unverified mapping is not ready');
});

test('payment is blocked on plan-id, currency, price or cycle mismatch', () => {
  const base = { providerOk: true, providerCode: 'ok', currency: 'USD', planId: 'plan_x', expectedPriceMinor: 29_000 };
  assert.equal(paymentReadiness({ ...base, mapping: { ...verifiedMapping, planId: 'other' } }).level, 'blocked');
  assert.equal(paymentReadiness({ ...base, mapping: { ...verifiedMapping, currency: 'EUR' } }).level, 'blocked');
  assert.equal(paymentReadiness({ ...base, mapping: { ...verifiedMapping, priceMinor: 1_000 } }).level, 'blocked');
  assert.equal(paymentReadiness({ ...base, mapping: { ...verifiedMapping, billingCycle: 'weird' } }).level, 'blocked');
});

test('payment is ok only with a healthy provider and a fully verified mapping', () => {
  const check = paymentReadiness({ providerOk: true, providerCode: 'ok', currency: 'USD', planId: 'plan_x', mapping: verifiedMapping, expectedPriceMinor: 29_000 });
  assert.equal(check.level, 'ok');
  assert.equal(check.action, undefined);
});

test('worst() escalates to the most severe level', () => {
  assert.equal(worst(['ok', 'ok']), 'ok');
  assert.equal(worst(['ok', 'warn']), 'warn');
  assert.equal(worst(['warn', 'unknown']), 'warn');
  assert.equal(worst(['warn', 'blocked']), 'blocked');
  assert.equal(worst([]), 'ok');
});
