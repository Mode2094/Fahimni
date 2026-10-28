import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WHATSAPP_MESSAGE,
  configuredWhatsAppHref,
  normalizeWhatsAppNumber,
  whatsAppHref,
} from '../lib/contact/whatsapp';

test('whatsapp number normalization accepts international formats only', () => {
  assert.equal(normalizeWhatsAppNumber('+962 79 000 0000'), '962790000000');
  assert.equal(normalizeWhatsAppNumber('00962790000000'), '962790000000');
  assert.equal(normalizeWhatsAppNumber('962-790-000-000'), '962790000000');
  assert.equal(normalizeWhatsAppNumber(' 962790000000 '), '962790000000');

  assert.equal(normalizeWhatsAppNumber(''), null);
  assert.equal(normalizeWhatsAppNumber(undefined), null);
  assert.equal(normalizeWhatsAppNumber(null), null);
  assert.equal(normalizeWhatsAppNumber('not a number'), null);
  assert.equal(normalizeWhatsAppNumber('1234567'), null); // too short
  assert.equal(normalizeWhatsAppNumber('1234567890123456'), null); // too long
  assert.equal(normalizeWhatsAppNumber('00000000'), null); // not a real number
});

test('whatsapp link uses wa.me with the encoded prefilled message', () => {
  const href = whatsAppHref('+962790000000');
  assert.equal(href, `https://wa.me/962790000000?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`);
  assert.match(href ?? '', /^https:\/\/wa\.me\/962790000000\?text=/);
  assert.equal(whatsAppHref(''), null);
  assert.equal(whatsAppHref('abc'), null);
});

test('contact section is only configured when a valid env number exists', () => {
  const env = (value?: string) => ({ NEXT_PUBLIC_WHATSAPP_NUMBER: value }) as unknown as NodeJS.ProcessEnv;
  assert.equal(configuredWhatsAppHref({} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(configuredWhatsAppHref(env('')), null);
  assert.equal(configuredWhatsAppHref(env('junk')), null);
  assert.equal(
    configuredWhatsAppHref(env('+962 79 123 4567')),
    `https://wa.me/962791234567?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`,
  );
});
