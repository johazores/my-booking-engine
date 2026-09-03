import assert from 'node:assert/strict';
import test from 'node:test';

import { assessAustralianTaxInvoiceReadiness } from './australian-tax-invoice-domain.ts';

const issuer = {
  countryCode: 'AU',
  registrations: [
    { scheme: 'ABN', identifier: '51 824 753 556', countryCode: 'AU' },
    { scheme: 'GST', identifier: '51824753556', countryCode: 'AU' },
  ],
};
const individualBuyer = { recipientType: 'INDIVIDUAL' as const, legalName: 'Example Buyer', registrations: [] };

function pricing(totalMinor = '11000', taxTotalMinor = '1000') {
  return {
    currency: 'AUD',
    taxTotalMinor,
    totalMinor,
    charges: [{ code: 'GST', kind: 'TAX', amountMinor: taxTotalMinor }],
  };
}

test('accepts the deliberately narrow fully-taxable Australian GST contract', () => {
  const result = assessAustralianTaxInvoiceReadiness({ issuer, pricing: pricing(), buyer: individualBuyer });
  assert.equal(result.contentReady, true);
  assert.equal(result.supplierAbn, '51824753556');
  assert.equal(result.buyerIdentityRequired, false);
  assert.equal(result.buyerIdentity, 'Example Buyer');
  assert.deepEqual(result.requirements, []);
});

test('requires immutable buyer identity or ABN at AUD 1,000 or more', () => {
  const withoutBuyer = assessAustralianTaxInvoiceReadiness({ issuer, pricing: pricing('110000', '10000') });
  assert.equal(withoutBuyer.contentReady, false);
  assert.equal(withoutBuyer.buyerIdentityRequired, true);
  assert.equal(withoutBuyer.requirements.some((item) => item.code === 'BUYER_IDENTITY_REQUIRED'), true);

  const withBuyer = assessAustralianTaxInvoiceReadiness({
    issuer,
    pricing: pricing('110000', '10000'),
    buyer: individualBuyer,
  });
  assert.equal(withBuyer.contentReady, true);
});

test('supports a structurally validated Australian business recipient ABN', () => {
  const result = assessAustralianTaxInvoiceReadiness({
    issuer,
    pricing: pricing('110000', '10000'),
    buyer: {
      recipientType: 'BUSINESS',
      legalName: 'Example Buyer Pty Ltd',
      registrations: [{ scheme: 'ABN', identifier: '12 004 021 809', countryCode: 'AU' }],
    },
  });
  assert.equal(result.contentReady, true);
  assert.equal(result.buyerAbn, '12004021809');
});

test('fails closed on invalid or ambiguous recipient ABN evidence', () => {
  const invalid = assessAustralianTaxInvoiceReadiness({
    issuer,
    pricing: pricing(),
    buyer: {
      recipientType: 'BUSINESS',
      legalName: 'Buyer Pty Ltd',
      registrations: [{ scheme: 'ABN', identifier: '12345678901', countryCode: 'AU' }],
    },
  });
  assert.equal(invalid.contentReady, false);
  assert.equal(invalid.requirements.some((item) => item.code === 'BUYER_ABN_INVALID'), true);

  const multiple = assessAustralianTaxInvoiceReadiness({
    issuer,
    pricing: pricing(),
    buyer: {
      recipientType: 'BUSINESS',
      legalName: 'Buyer Pty Ltd',
      registrations: [
        { scheme: 'ABN', identifier: '51 824 753 556', countryCode: 'AU' },
        { scheme: 'ABN', identifier: '12 004 021 809', countryCode: 'AU' },
      ],
    },
  });
  assert.equal(multiple.contentReady, false);
  assert.equal(multiple.requirements.some((item) => item.code === 'BUYER_ABN_MULTIPLE'), true);
});

test('fails closed on missing GST declaration, invalid ABN, non-AUD money, and mixed tax schemes', () => {
  const result = assessAustralianTaxInvoiceReadiness({
    issuer: {
      countryCode: 'AU',
      registrations: [{ scheme: 'ABN', identifier: '12345678901', countryCode: 'AU' }],
    },
    pricing: {
      currency: 'USD',
      taxTotalMinor: '1000',
      totalMinor: '12000',
      charges: [
        { code: 'GST', kind: 'TAX', amountMinor: '900' },
        { code: 'CITY_TAX', kind: 'TAX', amountMinor: '100' },
      ],
    },
    buyer: individualBuyer,
  });
  const codes = result.requirements.map((item) => item.code);
  assert.equal(result.contentReady, false);
  assert.equal(codes.includes('ISSUER_ABN_INVALID'), true);
  assert.equal(codes.includes('GST_REGISTRATION_DECLARATION_MISSING'), true);
  assert.equal(codes.includes('CURRENCY_UNSUPPORTED'), true);
  assert.equal(codes.includes('MULTIPLE_TAX_SCHEMES_UNSUPPORTED'), true);
  assert.equal(codes.includes('GST_TOTAL_MISMATCH'), true);
  assert.equal(codes.includes('STANDARD_GST_EVIDENCE_INCOMPLETE'), true);
});

test('requires the GST declaration to carry the same ABN as the issuer', () => {
  const result = assessAustralianTaxInvoiceReadiness({
    issuer: {
      countryCode: 'AU',
      registrations: [
        { scheme: 'ABN', identifier: '51 824 753 556', countryCode: 'AU' },
        { scheme: 'GST', identifier: '12 004 021 809', countryCode: 'AU' },
      ],
    },
    pricing: pricing(),
    buyer: individualBuyer,
  });
  assert.equal(result.contentReady, false);
  assert.equal(result.requirements.some((item) => item.code === 'GST_REGISTRATION_ABN_MISMATCH'), true);
});
