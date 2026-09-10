import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const helper = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-receipt-evidence.ts', import.meta.url),
  'utf8',
);

const cancellationStart = helper.indexOf('function inspectCancellationReceipt');
const inspectorStart = helper.indexOf('export function inspectTravelportStaysReservationReceiptEvidence');
const cancellationHelper = helper.slice(cancellationStart, inspectorStart);
const confirmationInspector = helper.slice(inspectorStart);

test('hospitality offer status uses one narrow discriminator claim helper', () => {
  assert.match(
    helper,
    /function claimsHospitalityOfferStatus\(value: unknown\)[\s\S]*value\.trim\(\) === 'OfferStatusHospitality'/,
  );
  assert.equal(
    (helper.match(/claimsHospitalityOfferStatus\(rawOfferStatusType\)/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(helper, /claimsHospitalityStatus = Boolean\(rawOfferStatusType\)/);
});

test('confirmation hospitality status cannot bypass Stays locator identity validation', () => {
  const hospitalitySignal = confirmationInspector.indexOf(
    'const claimsHospitalityStatus = claimsHospitalityOfferStatus(rawOfferStatusType);',
  );
  const genericLocatorBranch = confirmationInspector.indexOf('if (!hasSourceContext && !hasLocatorType)');
  const genericHospitalityRejection = confirmationInspector.indexOf('if (claimsHospitalityStatus) return invalidEvidence();');
  const partialIdentityRejection = confirmationInspector.indexOf('if (isStaysSourceContext(sourceContext) || claimsHospitalityStatus)');
  const mismatchedPairRejection = confirmationInspector.indexOf('(hasStaysSourceContext || hasStaysLocatorType || claimsHospitalityStatus)');

  assert.ok(hospitalitySignal >= 0);
  assert.ok(genericLocatorBranch > hospitalitySignal);
  assert.ok(genericHospitalityRejection > genericLocatorBranch);
  assert.ok(partialIdentityRejection > genericHospitalityRejection);
  assert.ok(mismatchedPairRejection > partialIdentityRejection);
});

test('ReceiptCancellation hospitality status cannot bypass Stays locator identity validation', () => {
  const hospitalitySignal = cancellationHelper.indexOf(
    'const claimsHospitalityStatus = claimsHospitalityOfferStatus(rawOfferStatusType);',
  );
  const malformedTypeRejection = cancellationHelper.indexOf(
    '(hasCanonicalStaysPair || hasStaysLocatorType || claimsHospitalityStatus)',
  );
  const missingIdentityRejection = cancellationHelper.indexOf(
    'if (claimsHospitalityStatus && (!hasSourceContext || !hasLocatorType))',
  );
  const foreignIdentityRejection = cancellationHelper.indexOf(
    'hasHospitalityStatus\n    && (hasSourceContext || hasLocatorType)\n    && !hasCanonicalStaysPair',
  );

  assert.ok(hospitalitySignal >= 0);
  assert.ok(malformedTypeRejection > hospitalitySignal);
  assert.ok(missingIdentityRejection > malformedTypeRejection);
  assert.ok(foreignIdentityRejection > missingIdentityRejection);
});
