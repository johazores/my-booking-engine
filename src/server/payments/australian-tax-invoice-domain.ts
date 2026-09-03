import { normalizeAustralianBusinessNumber } from './australian-business-number-domain.ts';

const AUSTRALIAN_TAX_INVOICE_BUYER_IDENTITY_THRESHOLD_MINOR = 100_000n;

export const australianTaxInvoiceContract = Object.freeze({
  schemaVersion: 1 as const,
  jurisdictionCode: 'AU' as const,
  currency: 'AUD' as const,
  documentLabel: 'Tax invoice' as const,
  buyerIdentityThresholdMinor: AUSTRALIAN_TAX_INVOICE_BUYER_IDENTITY_THRESHOLD_MINOR,
  supportedTaxScheme: 'GST' as const,
  supportedSupplyTaxability: 'FULLY_TAXABLE_STANDARD_GST' as const,
});

export type AustralianTaxInvoiceRequirementCode =
  | 'ISSUER_COUNTRY_UNSUPPORTED'
  | 'CURRENCY_UNSUPPORTED'
  | 'ISSUER_ABN_MISSING'
  | 'ISSUER_ABN_INVALID'
  | 'GST_REGISTRATION_DECLARATION_MISSING'
  | 'GST_REGISTRATION_ABN_MISMATCH'
  | 'GST_LINE_MISSING'
  | 'MULTIPLE_TAX_SCHEMES_UNSUPPORTED'
  | 'GST_TOTAL_MISMATCH'
  | 'STANDARD_GST_EVIDENCE_INCOMPLETE'
  | 'BUYER_ABN_MULTIPLE'
  | 'BUYER_ABN_INVALID'
  | 'BUYER_IDENTITY_REQUIRED';

export type AustralianTaxInvoiceRequirement = Readonly<{
  code: AustralianTaxInvoiceRequirementCode;
  message: string;
}>;

type Registration = Readonly<{
  scheme: string;
  identifier: string;
  countryCode: string;
}>;

type IssuerSnapshot = Readonly<{
  countryCode: string;
  registrations: readonly Registration[];
}>;

type BuyerSnapshot = Readonly<{
  recipientType: 'INDIVIDUAL' | 'BUSINESS';
  legalName: string;
  registrations: readonly Registration[];
}>;

type PricingBreakdown = Readonly<{
  currency: string;
  taxTotalMinor: string;
  totalMinor: string;
  charges: ReadonlyArray<Readonly<{
    code: string;
    kind: string;
    amountMinor: string;
  }>>;
}>;

function requirement(code: AustralianTaxInvoiceRequirementCode, message: string): AustralianTaxInvoiceRequirement {
  return Object.freeze({ code, message });
}

function normalizedRegistrationScheme(value: string) {
  return value.trim().toUpperCase();
}

function registrationFor(input: { registrations: readonly Registration[] }, scheme: 'ABN' | 'GST') {
  return input.registrations.filter((entry) =>
    entry.countryCode.trim().toUpperCase() === 'AU'
    && normalizedRegistrationScheme(entry.scheme) === scheme);
}

function parseMinorUnits(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer minor-unit amount.`);
  return BigInt(value);
}

function assessBuyer(input: BuyerSnapshot | null | undefined, requirements: AustralianTaxInvoiceRequirement[]) {
  const buyerIdentity = input?.legalName.trim() || null;
  const abnRegistrations = input ? registrationFor(input, 'ABN') : [];
  let buyerAbn: string | null = null;
  if (abnRegistrations.length > 1) {
    requirements.push(requirement('BUYER_ABN_MULTIPLE', 'At most one Australian ABN may identify the invoice recipient.'));
  } else if (abnRegistrations.length === 1) {
    try {
      buyerAbn = normalizeAustralianBusinessNumber(abnRegistrations[0]?.identifier);
    } catch {
      requirements.push(requirement('BUYER_ABN_INVALID', 'The recipient ABN is not structurally valid.'));
    }
  }
  return { buyerIdentity, buyerAbn };
}

export function assessAustralianTaxInvoiceReadiness(input: {
  issuer: IssuerSnapshot;
  pricing: PricingBreakdown;
  buyer?: BuyerSnapshot | null;
}) {
  const requirements: AustralianTaxInvoiceRequirement[] = [];
  const issuerCountryCode = input.issuer.countryCode.trim().toUpperCase();
  if (issuerCountryCode !== 'AU') {
    requirements.push(requirement('ISSUER_COUNTRY_UNSUPPORTED', 'Australian tax invoices require an Australian issuer profile.'));
  }

  const currency = input.pricing.currency.trim().toUpperCase();
  if (currency !== 'AUD') {
    requirements.push(requirement('CURRENCY_UNSUPPORTED', 'The initial Australian tax-invoice contract supports AUD bookings only.'));
  }

  const abnRegistrations = registrationFor(input.issuer, 'ABN');
  let abn: string | null = null;
  if (abnRegistrations.length !== 1) {
    requirements.push(requirement('ISSUER_ABN_MISSING', 'Exactly one Australian ABN registration is required for the issuer.'));
  } else {
    try {
      abn = normalizeAustralianBusinessNumber(abnRegistrations[0]?.identifier);
    } catch {
      requirements.push(requirement('ISSUER_ABN_INVALID', 'The issuer ABN is not structurally valid.'));
    }
  }

  const gstRegistrations = registrationFor(input.issuer, 'GST');
  if (gstRegistrations.length !== 1) {
    requirements.push(requirement(
      'GST_REGISTRATION_DECLARATION_MISSING',
      'Exactly one Australian GST registration declaration is required before a tax invoice can be prepared.',
    ));
  } else if (abn) {
    try {
      const gstAbn = normalizeAustralianBusinessNumber(gstRegistrations[0]?.identifier);
      if (gstAbn !== abn) {
        requirements.push(requirement('GST_REGISTRATION_ABN_MISMATCH', 'The declared GST registration must belong to the issuer ABN.'));
      }
    } catch {
      requirements.push(requirement('GST_REGISTRATION_ABN_MISMATCH', 'The declared GST registration must contain the issuer ABN.'));
    }
  }

  const taxLines = input.pricing.charges.filter((line) => line.kind.trim().toUpperCase() === 'TAX');
  const gstLines = taxLines.filter((line) => line.code.trim().toUpperCase() === 'GST');
  if (gstLines.length !== 1) {
    requirements.push(requirement('GST_LINE_MISSING', 'The initial Australian contract requires exactly one persisted GST tax line.'));
  }
  if (taxLines.some((line) => line.code.trim().toUpperCase() !== 'GST')) {
    requirements.push(requirement(
      'MULTIPLE_TAX_SCHEMES_UNSUPPORTED',
      'The initial Australian contract does not issue documents containing non-GST tax schemes.',
    ));
  }

  const taxTotalMinor = parseMinorUnits(input.pricing.taxTotalMinor, 'taxTotalMinor');
  const totalMinor = parseMinorUnits(input.pricing.totalMinor, 'totalMinor');
  if (gstLines.length === 1) {
    const gstLineMinor = parseMinorUnits(gstLines[0]?.amountMinor ?? '', 'GST line amount');
    if (gstLineMinor !== taxTotalMinor) {
      requirements.push(requirement('GST_TOTAL_MISMATCH', 'Persisted GST line money must equal the accepted booking tax total.'));
    }
  }

  if (totalMinor <= 0n || taxTotalMinor <= 0n || taxTotalMinor * 11n !== totalMinor) {
    requirements.push(requirement(
      'STANDARD_GST_EVIDENCE_INCOMPLETE',
      'The initial Australian contract requires fully taxable standard-GST pricing where persisted GST is exactly one-eleventh of the GST-inclusive total.',
    ));
  }

  const { buyerIdentity, buyerAbn } = assessBuyer(input.buyer, requirements);
  const buyerIdentityRequired = totalMinor >= AUSTRALIAN_TAX_INVOICE_BUYER_IDENTITY_THRESHOLD_MINOR;
  if (buyerIdentityRequired && !buyerIdentity && !buyerAbn) {
    requirements.push(requirement('BUYER_IDENTITY_REQUIRED', 'Australian tax invoices of AUD 1,000 or more require buyer identity or ABN.'));
  }

  return Object.freeze({
    contract: australianTaxInvoiceContract,
    contentReady: requirements.length === 0,
    supplierAbn: abn,
    buyerIdentityRequired,
    buyerIdentity,
    buyerAbn,
    requirements: Object.freeze(requirements),
  });
}
