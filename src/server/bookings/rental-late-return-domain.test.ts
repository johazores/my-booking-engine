import assert from 'node:assert/strict';
import test from 'node:test';

import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import {
  deriveRentalLateReturnTiming,
  normalizeRentalLateReturnAssessmentInput,
} from './rental-late-return-domain.ts';

test('late-return timing uses the retained location local date and exclusive committed end', () => {
  const timing = deriveRentalLateReturnTiming({
    returnedAt: new Date('2026-09-12T15:30:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
    graceDays: 0,
  });
  assert.deepEqual(timing, {
    returnedLocalDate: '2026-09-12',
    lateDays: 1,
    chargeableDays: 1,
  });

  assert.deepEqual(deriveRentalLateReturnTiming({
    returnedAt: new Date('2026-09-11T15:59:59.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
    graceDays: 0,
  }), {
    returnedLocalDate: '2026-09-11',
    lateDays: 0,
    chargeableDays: 0,
  });

  assert.deepEqual(deriveRentalLateReturnTiming({
    returnedAt: new Date('2026-09-14T02:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
    graceDays: 1,
  }), {
    returnedLocalDate: '2026-09-14',
    lateDays: 3,
    chargeableDays: 2,
  });
});

test('manual fee assessment remains available when no automatic policy applied at return', () => {
  assert.deepEqual(normalizeRentalLateReturnAssessmentInput({
    outcome: 'fee_assessed',
    graceDays: '1',
    feeAmountMajor: '75.50',
    reason: '  Approved   late return fee. ',
  }, {
    currency: 'USD',
    returnedAt: new Date('2026-09-13T12:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
  }), {
    outcome: 'FEE_ASSESSED',
    graceDays: 1,
    lateDays: 2,
    chargeableDays: 1,
    currency: 'USD',
    feeMinor: 7550n,
    policyRevisionId: null,
    policyDailyFeeMinor: null,
    reason: 'Approved late return fee.',
  });

  assert.throws(() => normalizeRentalLateReturnAssessmentInput({
    outcome: 'FEE_ASSESSED',
    graceDays: '2',
    feeAmountMajor: '10.00',
    reason: 'Inside grace',
  }, {
    currency: 'USD',
    returnedAt: new Date('2026-09-13T12:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
  }), /inside the selected grace period/);
});

test('active policy derives grace and exact fee without trusting browser money', () => {
  assert.deepEqual(normalizeRentalLateReturnAssessmentInput({
    outcome: 'FEE_ASSESSED',
    graceDays: '',
    feeAmountMajor: '',
    reason: 'Policy fee applied.',
  }, {
    currency: 'PHP',
    returnedAt: new Date('2026-09-15T08:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
    policy: {
      id: 'policy-revision-2',
      currency: 'PHP',
      graceDays: 1,
      dailyFeeMinor: 12500n,
    },
  }), {
    outcome: 'FEE_ASSESSED',
    graceDays: 1,
    lateDays: 4,
    chargeableDays: 3,
    currency: 'PHP',
    feeMinor: 37500n,
    policyRevisionId: 'policy-revision-2',
    policyDailyFeeMinor: 12500n,
    reason: 'Policy fee applied.',
  });

  assert.throws(() => normalizeRentalLateReturnAssessmentInput({
    outcome: 'FEE_ASSESSED',
    graceDays: '',
    feeAmountMajor: '',
    reason: 'Overflowing policy total.',
  }, {
    currency: 'USD',
    returnedAt: new Date('2026-09-13T08:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
    policy: {
      id: 'policy-overflow',
      currency: 'USD',
      graceDays: 0,
      dailyFeeMinor: 9_000_000_000_000_000n,
    },
  }), /exceeds the supported money range/);

  assert.throws(() => normalizeRentalLateReturnAssessmentInput({
    outcome: 'FEE_ASSESSED',
    graceDays: '0',
    feeAmountMajor: '1.00',
    reason: 'Tampered override.',
  }, {
    currency: 'PHP',
    returnedAt: new Date('2026-09-15T08:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
    policy: {
      id: 'policy-revision-2',
      currency: 'PHP',
      graceDays: 1,
      dailyFeeMinor: 12500n,
    },
  }), /cannot be overridden/);

  assert.throws(() => normalizeRentalLateReturnAssessmentInput({
    outcome: 'FEE_ASSESSED',
    graceDays: '',
    feeAmountMajor: '',
    reason: 'Inside policy grace.',
  }, {
    currency: 'PHP',
    returnedAt: new Date('2026-09-12T08:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
    policy: {
      id: 'policy-revision-2',
      currency: 'PHP',
      graceDays: 1,
      dailyFeeMinor: 12500n,
    },
  }), /inside the active late-return policy grace period/);
});

test('policy waiver retains policy evidence but never a fee', () => {
  assert.deepEqual(normalizeRentalLateReturnAssessmentInput({
    outcome: 'WAIVED',
    graceDays: '',
    feeAmountMajor: '',
    reason: 'Manager goodwill exception.',
  }, {
    currency: 'AUD',
    returnedAt: new Date('2026-09-14T01:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
    policy: {
      id: 'policy-aud-1',
      currency: 'AUD',
      graceDays: 1,
      dailyFeeMinor: 5000n,
    },
  }), {
    outcome: 'WAIVED',
    graceDays: 1,
    lateDays: 3,
    chargeableDays: 2,
    currency: 'AUD',
    feeMinor: null,
    policyRevisionId: 'policy-aud-1',
    policyDailyFeeMinor: 5000n,
    reason: 'Manager goodwill exception.',
  });
});

test('manual waiver preserves explicit reason and invalid evidence fails closed', () => {
  assert.deepEqual(normalizeRentalLateReturnAssessmentInput({
    outcome: 'WAIVED',
    graceDays: '3',
    feeAmountMajor: '',
    reason: '  Manager approved goodwill waiver. ',
  }, {
    currency: 'AUD',
    returnedAt: new Date('2026-09-14T01:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
  }), {
    outcome: 'WAIVED',
    graceDays: 3,
    lateDays: 3,
    chargeableDays: 0,
    currency: 'AUD',
    feeMinor: null,
    policyRevisionId: null,
    policyDailyFeeMinor: null,
    reason: 'Manager approved goodwill waiver.',
  });

  assert.throws(() => normalizeRentalLateReturnAssessmentInput({
    outcome: 'WAIVED',
    graceDays: '31',
    feeAmountMajor: '',
    reason: 'Waived',
  }, {
    currency: 'AUD',
    returnedAt: new Date('2026-09-12T01:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
  }), RentalInventoryValidationError);

  assert.throws(() => normalizeRentalLateReturnAssessmentInput({
    outcome: 'WAIVED',
    graceDays: '0',
    feeAmountMajor: '',
    reason: 'Waived',
  }, {
    currency: 'AUD',
    returnedAt: new Date('2026-09-11T01:00:00.000Z'),
    committedEndsOn: new Date('2026-09-12T00:00:00.000Z'),
    timeZone: 'UTC',
  }), /requires return evidence after the committed rental period/);
});
