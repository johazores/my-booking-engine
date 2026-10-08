import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/book/[organization-slug]/public-booking-flow.tsx', import.meta.url), 'utf8');

test('offer actions are serialized before issuing overlapping writes', () => {
  assert.ok(source.includes("holdOperation.current = 'reserving'"));
  assert.ok(source.includes("holdOperation.current = 'releasing'"));
  assert.ok(source.includes("holdOperation.current = 'confirming'"));
  assert.match(source, /if \(holdOperation\.current \|\| !holdCapability \|\| !quote\) return/);
  assert.equal((source.match(/holdOperation\.current = null;/g) || []).length, 3);
});

test('releasing has a pending state and failed releases retain an explicit retry', () => {
  assert.match(source, /setStage\('releasing'\)/);
  assert.ok(source.includes("stage === 'releasing'"));
  assert.ok(source.includes('Retry releasing hold'));
  assert.match(source, /if \(!released\) \{\s*setReleaseFailed\(true\);\s*setStage\('error'\)/);
  assert.match(source, /clearHoldClientState\(\);\s*setStage\('idle'\);\s*\} finally/);
});

test('malformed reviewed quote follows the hold cleanup path', () => {
  assert.ok(source.includes('function isReviewedQuote(value: unknown): value is Quote'));
  assert.ok(source.includes('typeof quote.currency'));
  assert.ok(source.includes('typeof quote.totalMinor'));
  assert.ok(source.includes('typeof quote.pricingFingerprint'));
  assert.ok(source.includes('Number.isFinite(Date.parse(quote.holdExpiresAt))'));
  assert.ok(source.includes('if (!isReviewedQuote(quoteResult.quote))'));
  assert.ok(source.includes('const released = await requestHoldRelease(createdCapability)'));
  assert.ok(source.includes('setReleaseFailed(true)'));
});
