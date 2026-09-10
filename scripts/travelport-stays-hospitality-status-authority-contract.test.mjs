import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const helper = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-receipt-evidence.ts', import.meta.url),
  'utf8',
);

test('hospitality offer status cannot bypass Stays locator identity validation', () => {
  const hospitalitySignal = helper.indexOf("const claimsHospitalityStatus = rawOfferStatusType === 'OfferStatusHospitality'");
  const genericLocatorBranch = helper.indexOf('if (!hasSourceContext && !hasLocatorType)');
  const genericHospitalityRejection = helper.indexOf('if (claimsHospitalityStatus) return invalidEvidence();');
  const partialIdentityRejection = helper.indexOf('if (isStaysSourceContext(sourceContext) || claimsHospitalityStatus)');
  const mismatchedPairRejection = helper.indexOf('(hasStaysSourceContext || hasStaysLocatorType || claimsHospitalityStatus)');

  assert.ok(hospitalitySignal >= 0);
  assert.ok(genericLocatorBranch > hospitalitySignal);
  assert.ok(genericHospitalityRejection > genericLocatorBranch);
  assert.ok(partialIdentityRejection > genericHospitalityRejection);
  assert.ok(mismatchedPairRejection > partialIdentityRejection);
});

test('multi-content status discriminators remain narrowly scoped to hospitality', () => {
  assert.match(helper, /rawOfferStatusType\.trim\(\) === 'OfferStatusHospitality'/);
  assert.doesNotMatch(helper, /claimsHospitalityStatus = Boolean\(rawOfferStatusType\)/);
});
