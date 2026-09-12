import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  assertTravelportStaysRulesMemberAuthorityResponse,
  createTravelportStaysRulesMemberAuthorityFetch,
} from './travelport-stays-rules-member-authority.ts';

function invalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

function rulesResponse() {
  return {
    OfferHospitalityResponse: {
      Offer: {
        TermsAndConditionsFull: [{
          AcceptedCreditCard: [{ value: 'VI' }, { value: 'MC' }],
          TextBlock: [{
            title: 'Cancellation',
            TextFormatted: [
              { language: 'EN', value: 'Cancel before the deadline to avoid the fee.' },
              { value: 'No-show charges may apply.' },
            ],
          }],
        }],
      },
    },
  };
}

test('canonical Rules collection members remain accepted', () => {
  assert.doesNotThrow(() => assertTravelportStaysRulesMemberAuthorityResponse(rulesResponse()));

  const optional = rulesResponse();
  const optionalTerms = optional.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]! as {
    AcceptedCreditCard?: unknown;
    TextBlock?: unknown;
  };
  delete optionalTerms.AcceptedCreditCard;
  delete optionalTerms.TextBlock;
  assert.doesNotThrow(() => assertTravelportStaysRulesMemberAuthorityResponse(optional));
});

test('present accepted-card members require a non-empty exact code', () => {
  for (const value of [undefined, null, '', 'V', 'VISA', ' VI', 'VI ', 'V\tI']) {
    const payload = rulesResponse();
    payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.AcceptedCreditCard = [{
      ...(value !== undefined ? { value } : {}),
    }] as never;
    assert.throws(() => assertTravelportStaysRulesMemberAuthorityResponse(payload), invalidResponse);
  }
});

test('present text blocks require at least one formatted-text member', () => {
  for (const textFormatted of [undefined, null, []]) {
    const payload = rulesResponse();
    payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.TextBlock = [{
      title: 'Cancellation',
      ...(textFormatted !== undefined ? { TextFormatted: textFormatted } : {}),
    }] as never;
    assert.throws(() => assertTravelportStaysRulesMemberAuthorityResponse(payload), invalidResponse);
  }
});

test('present formatted-text members require non-empty retained commercial text', () => {
  for (const value of [undefined, null, '', '   ', '\t', 'x'.repeat(2_001)]) {
    const payload = rulesResponse();
    payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.TextBlock = [{
      TextFormatted: [{ ...(value !== undefined ? { value } : {}) }],
    }] as never;
    assert.throws(() => assertTravelportStaysRulesMemberAuthorityResponse(payload), invalidResponse);
  }
});

test('fetch wrapper validates successful Rules payloads and leaves unrelated successful JSON compatible', async () => {
  const guardedRulesFetch = createTravelportStaysRulesMemberAuthorityFetch(async () => new Response(JSON.stringify(rulesResponse()), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  const response = await guardedRulesFetch('https://example.invalid/rules');
  assert.equal(response.status, 200);

  const guardedOauthFetch = createTravelportStaysRulesMemberAuthorityFetch(async () => new Response(JSON.stringify({ access_token: 'token' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  await assert.doesNotReject(() => guardedOauthFetch('https://example.invalid/oauth'));
});
