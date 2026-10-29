import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'settings-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';

import { chargeAiCredits } from '../lib/ai/access';
import { createMemoryDailyBudget } from '../lib/ai/budget';
import { aiRuntimeConfig } from '../lib/ai/runtime-config';
import type { BillingStore, SubscriptionOfferRecord } from '../lib/billing/store';
import { decryptSecret, encryptSecret, encryptionConfigured, parseRootKey, SettingsCryptoError } from '../lib/settings/crypto';
import { normalizeWhatsAppNumber, whatsAppHref, configuredWhatsAppHref } from '../lib/contact/whatsapp';
import { checkoutStatus, isCheckoutReady, isDemoPlanId } from '../lib/freemius/readiness';
import { syncOffer } from '../lib/freemius/sync';
import type { FreemiusAutomationApi } from '../lib/freemius/automation';
import { findPlanForOffer, planSlugForOffer, plansFromPricingTable, verifyOfferAgainstProvider, type ProviderPlan } from '../lib/freemius/verification';
import { createFakeProviderLinks } from './support/provider-links';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const env = (key: string) => ({ SETTINGS_ENCRYPTION_KEY: key }) as unknown as NodeJS.ProcessEnv;

test('secret encryption round-trips and fails closed on tampering or a wrong key', () => {
  const payload = encryptSecret('sk-مفتاح-سري-123', env(TEST_KEY));
  assert.notEqual(payload, 'sk-مفتاح-سري-123');
  assert.equal(decryptSecret(payload, env(TEST_KEY)), 'sk-مفتاح-سري-123');
  assert.equal(encryptionConfigured(env(TEST_KEY)), true);
  assert.equal(encryptionConfigured({} as NodeJS.ProcessEnv), false);
  assert.equal(parseRootKey('short'), null);

  const parts = payload.split(':');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64')].join(':');
  assert.throws(() => decryptSecret(tampered, env(TEST_KEY)), (error: unknown) => error instanceof SettingsCryptoError && error.code === 'decrypt_failed');
  assert.throws(() => decryptSecret(payload, env(OTHER_KEY)), (error: unknown) => error instanceof SettingsCryptoError && error.code === 'decrypt_failed');
  assert.throws(() => encryptSecret('x', {} as NodeJS.ProcessEnv), (error: unknown) => error instanceof SettingsCryptoError && error.code === 'missing_root_key');
  assert.throws(() => encryptSecret('x', env('not-a-key')), (error: unknown) => error instanceof SettingsCryptoError && error.code === 'invalid_root_key');
});

test('whatsapp numbers normalize to wa.me format and invalid values are rejected', () => {
  assert.equal(normalizeWhatsAppNumber('+962 79 123 4567'), '962791234567');
  assert.equal(normalizeWhatsAppNumber('00962-79-123-4567'), '962791234567');
  assert.equal(normalizeWhatsAppNumber('0791234567'), '0791234567');
  assert.equal(normalizeWhatsAppNumber('123'), null);
  assert.equal(normalizeWhatsAppNumber('0000000000'), null);
  assert.equal(normalizeWhatsAppNumber(''), null);
  assert.equal(normalizeWhatsAppNumber(null), null);

  const href = whatsAppHref('+962791234567');
  assert.ok(href?.startsWith('https://wa.me/962791234567?text='));
  assert.equal(whatsAppHref('123'), null);
  assert.equal(configuredWhatsAppHref({ NEXT_PUBLIC_WHATSAPP_NUMBER: '962791234567' } as unknown as NodeJS.ProcessEnv)?.includes('wa.me/962791234567'), true);
  assert.equal(configuredWhatsAppHref({} as NodeJS.ProcessEnv), null);
});

test('checkout status requires a verified provider link and never trusts demo ids', () => {
  assert.equal(checkoutStatus({ offerActive: false, link: null }), 'DRAFT');
  assert.equal(checkoutStatus({ offerActive: true, link: null }), 'PENDING_LINK');
  assert.equal(checkoutStatus({ offerActive: true, link: { status: 'SYNCING', verified: false, planId: 'plan-1' } }), 'SYNCING');
  assert.equal(checkoutStatus({ offerActive: true, link: { status: 'FAILED', verified: false, planId: 'plan-1' } }), 'SYNC_FAILED');
  assert.equal(checkoutStatus({ offerActive: true, link: { status: 'SYNCED', verified: false, planId: 'plan-1' } }), 'PENDING_LINK');
  assert.equal(checkoutStatus({ offerActive: true, link: { status: 'SYNCED', verified: true, planId: 'plan_demo_math' } }), 'PENDING_LINK');
  assert.equal(isDemoPlanId('plan_demo_math_monthly'), true);
  assert.equal(isDemoPlanId('12345'), false);
  const ready = checkoutStatus({ offerActive: true, link: { status: 'SYNCED', verified: true, planId: '12345' } });
  assert.equal(ready, 'READY');
  assert.equal(isCheckoutReady({ offerActive: true, link: { status: 'SYNCED', verified: true, planId: '12345' } }), true);
});

test('pricing-table mapping and verification detect price, currency and cycle mismatches', () => {
  const plans = plansFromPricingTable({
    plans: [
      {
        id: 111,
        name: 'fahimni-offer-1',
        title: 'Fahimni',
        pricing: [
          { id: 9, currency: 'jod', monthly_price: 39, annual_price: null, lifetime_price: 99 },
          { id: 10, currency: 'usd', monthly_price: 55, annual_price: null, lifetime_price: null },
        ],
      },
    ],
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].pricing[0].currency, 'JOD');
  assert.equal(plans[0].pricing[0].monthlyMinor, 3900);

  const plan: ProviderPlan = plans[0];
  // JOD is not a Freemius checkout currency: even if a provider plan carried a
  // JOD pricing row (impossible in production), checkout stays blocked.
  assert.deepEqual(verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'JOD', priceMinor: 3900 }, plan }), {
    ok: false,
    reason: 'unsupported_currency',
  });
  assert.deepEqual(verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'SEMESTER', currency: 'JOD', priceMinor: 9900 }, plan }), {
    ok: false,
    reason: 'unsupported_currency',
  });
  const monthly = verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'USD', priceMinor: 5500 }, plan });
  assert.equal(monthly.ok, true);
  if (monthly.ok) {
    assert.equal(monthly.billingCycle, 'monthly');
    assert.equal(monthly.pricingId, '10');
  }

  assert.deepEqual(verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'USD', priceMinor: 9900 }, plan }), {
    ok: false,
    reason: 'price_mismatch',
  });
  assert.deepEqual(verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'EUR', priceMinor: 3900 }, plan }), {
    ok: false,
    reason: 'currency_mismatch',
  });
  assert.deepEqual(verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'USD', priceMinor: 5500 }, plan }).ok, true);
  assert.deepEqual(
    verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'SEMESTER', currency: 'USD', priceMinor: 5500 }, plan }),
    { ok: false, reason: 'cycle_mismatch' },
  );
  assert.deepEqual(verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'USD', priceMinor: 5500 }, plan: null }), {
    ok: false,
    reason: 'plan_missing',
  });

  assert.equal(findPlanForOffer(plans, 'anything', '111')?.planId, '111');
  assert.equal(findPlanForOffer(plans, 'offer-1', null)?.planId, '111');
  assert.equal(findPlanForOffer(plans, 'offer-2', null), null);
  assert.equal(planSlugForOffer('ABC-123'), 'fahimni-abc-123');
});

function makeOffer(overrides: Partial<SubscriptionOfferRecord> = {}): SubscriptionOfferRecord {
  return {
    id: 'offer-1',
    dedupeKey: 'SUBJECT:s-math:MONTHLY:-',
    kind: 'SUBJECT',
    type: 'MONTHLY',
    subjectId: 's-math',
    gradeId: null,
    academicFieldId: null,
    academicTermId: null,
    freemiusPlanId: 'plan-1',
    priceMinor: 3900,
    monthlyCreditAllowance: 200,
    currency: 'USD',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeBilling(offer: SubscriptionOfferRecord): BillingStore {
  return { findSubscriptionOfferById: async () => offer } as unknown as BillingStore;
}

const matchingPlans: ProviderPlan[] = [
  {
    planId: 'plan-1',
    name: 'fahimni-offer-1',
    title: 'Fahimni',
    pricing: [{ pricingId: 'p-1', currency: 'USD', monthlyMinor: 3900, annualMinor: null, lifetimeMinor: 9900 }],
  },
];

function api(plans: ProviderPlan[], overrides: Partial<FreemiusAutomationApi> = {}): FreemiusAutomationApi {
  return {
    capabilities: { createPlan: false },
    listPlans: async () => plans,
    createPlan: async () => {
      throw new Error('unavailable');
    },
    ...overrides,
  };
}

test('sync verifies read-only when a matching provider plan exists', async () => {
  const links = createFakeProviderLinks();
  const outcome = await syncOffer('offer-1', {
    links: links.store,
    billing: fakeBilling(makeOffer()),
    api: api(matchingPlans),
    liveEnabled: false,
    dryRun: false,
  });
  assert.deepEqual(outcome.ok, true);
  assert.equal(outcome.status, 'SYNCED');
  const link = links.get('offer-1');
  assert.equal(link?.verified, true);
  assert.equal(link?.planId, 'plan-1');
  assert.equal(link?.priceMinor, 3900);
  assert.equal(link?.currency, 'USD');
  assert.equal(link?.billingCycle, 'monthly');
});

test('sync fails safely on mismatches and never marks the offer ready', async () => {
  const links = createFakeProviderLinks();
  const mismatch: ProviderPlan[] = [
    { planId: 'plan-1', name: null, title: null, pricing: [{ pricingId: 'p-1', currency: 'USD', monthlyMinor: 9900, annualMinor: null, lifetimeMinor: null }] },
  ];
  const outcome = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: api(mismatch), liveEnabled: false, dryRun: false });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 'FAILED');
  const link = links.get('offer-1');
  assert.equal(link?.status, 'FAILED');
  assert.equal(link?.verified, false);
  assert.equal(isCheckoutReady({ offerActive: true, link }), false);

  const currencyMismatch: ProviderPlan[] = [
    { planId: 'plan-1', name: null, title: null, pricing: [{ pricingId: 'p-1', currency: 'EUR', monthlyMinor: 3900, annualMinor: null, lifetimeMinor: null }] },
  ];
  const second = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: api(currencyMismatch), liveEnabled: false, dryRun: false });
  assert.equal(second.status, 'FAILED');
});

test('sync without credentials stays pending with an Arabic explanation', async () => {
  const links = createFakeProviderLinks();
  const outcome = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: null, liveEnabled: false, dryRun: false });
  assert.equal(outcome.status, 'NOT_CONFIGURED');
  const link = links.get('offer-1');
  assert.equal(link?.status, 'PENDING');
  assert.equal(link?.verified, false);
  assert.ok(link?.lastError?.includes('فريميوس'));
});

test('sync requires developer capability before creating plans', async () => {
  const links = createFakeProviderLinks();
  const outcome = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: api([]), liveEnabled: true, dryRun: false });
  assert.equal(outcome.status, 'PENDING');
  assert.ok(outcome.message.includes('مطوّر'));
  assert.equal(links.get('offer-1')?.verified, false);
});

test('live sync creates a plan once and stays idempotent across retries', async () => {
  const links = createFakeProviderLinks();
  let plans: ProviderPlan[] = [];
  let createCalls = 0;
  const liveApi = api([], {
    capabilities: { createPlan: true },
    listPlans: async () => plans,
    createPlan: async () => {
      createCalls += 1;
      plans = [
        { planId: 'created-1', name: planSlugForOffer('offer-1'), title: 'Fahimni', pricing: [{ pricingId: 'p-created', currency: 'USD', monthlyMinor: 3900, annualMinor: null, lifetimeMinor: null }] },
      ];
      return { planId: 'created-1', pricingId: 'p-created' };
    },
  });
  const first = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: liveApi, liveEnabled: true, dryRun: false });
  assert.equal(first.status, 'SYNCED');
  assert.equal(createCalls, 1);
  const second = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: liveApi, liveEnabled: true, dryRun: false });
  assert.equal(second.status, 'SYNCED');
  assert.equal(createCalls, 1);
});

test('sync refuses to run twice concurrently and reports creation failures', async () => {
  const links = createFakeProviderLinks();
  links.seed('offer-1', { status: 'SYNCING', verified: false });
  const running = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: api(matchingPlans), liveEnabled: true, dryRun: false });
  assert.equal(running.status, 'ALREADY_RUNNING');

  links.seed('offer-1', { status: 'PENDING', verified: false, planId: null });
  const failingApi = api([], {
    capabilities: { createPlan: true },
    createPlan: async () => {
      throw new Error('provider exploded');
    },
  });
  const failed = await syncOffer('offer-1', { links: links.store, billing: fakeBilling(makeOffer()), api: failingApi, liveEnabled: true, dryRun: false });
  assert.equal(failed.status, 'FAILED');
  assert.equal(links.get('offer-1')?.verified, false);
});

test('global daily budget blocks spending over the limit and releases on demand', async () => {
  const budget = createMemoryDailyBudget('ai-test');
  const first = await budget.reserve({ requestId: 'r1', amountMicroUsd: 600, budgetMicroUsd: 1000 });
  assert.equal(first.ok, true);
  const duplicate = await budget.reserve({ requestId: 'r1', amountMicroUsd: 600, budgetMicroUsd: 1000 });
  assert.equal(duplicate.ok, true);
  const second = await budget.reserve({ requestId: 'r2', amountMicroUsd: 600, budgetMicroUsd: 1000 });
  assert.equal(second.ok, false);
  await budget.release('r1');
  const third = await budget.reserve({ requestId: 'r3', amountMicroUsd: 600, budgetMicroUsd: 1000 });
  assert.equal(third.ok, true);
});

test('chargeAiCredits enforces the injected global budget before charging', async () => {
  const context = {
    trial: null,
    subject: { id: 's-math' },
    entitlement: { id: 'ent-1', creditBalance: 10, creditPeriodEndsAt: null },
    user: { id: 'u-1' },
    balance: 10,
  } as unknown as Parameters<typeof chargeAiCredits>[0];
  const billing = {
    chargeCredits: async () => ({ ok: true, balance: 9, duplicate: false }),
    refundCredits: async () => ({ ok: true, refunded: 1 }),
  } as unknown as BillingStore;
  const trials = {} as unknown as Parameters<typeof chargeAiCredits>[3];
  const trialBudgetFake = { reserve: async () => ({ ok: true, spentMicroUsd: 0 }), release: async () => undefined };

  const blocked = await chargeAiCredits(context, { operation: 'tutor', credits: 1, requestId: 'req-budget-1' }, billing, trials, trialBudgetFake, {
    budgetMicroUsd: 1,
    budget: createMemoryDailyBudget('ai-charge-test'),
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.failure.code, 'ai_budget');

  const allowed = await chargeAiCredits(context, { operation: 'tutor', credits: 1, requestId: 'req-budget-2' }, billing, trials, trialBudgetFake, {
    budgetMicroUsd: 10_000_000,
    budget: createMemoryDailyBudget('ai-charge-test-2'),
  });
  assert.equal(allowed.ok, true);

  // A disabled (null) global budget never blocks paying students.
  const noBudget = await chargeAiCredits(context, { operation: 'tutor', credits: 1, requestId: 'req-budget-3' }, billing, trials, trialBudgetFake, null);
  assert.equal(noBudget.ok, true);
});

test('ai runtime config falls back to environment values when the settings store is unavailable', async () => {
  const config = await aiRuntimeConfig({ OPENAI_API_KEY: 'env-key', OPENAI_TUTOR_MODEL: 'env-model' } as unknown as NodeJS.ProcessEnv);
  assert.equal(config.apiKey, 'env-key');
  assert.equal(config.tutorModel, 'env-model');
  assert.equal(config.dailyBudgetUsd, 0);
  const empty = await aiRuntimeConfig({} as NodeJS.ProcessEnv);
  assert.equal(empty.apiKey, null);
  assert.equal(empty.tutorModel, 'gpt-4.1-mini');
});
