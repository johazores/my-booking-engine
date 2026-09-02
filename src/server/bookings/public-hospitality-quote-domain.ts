export type PublicHospitalityQuoteInput = {
  arrivalDate: string;
  departureDate: string;
  stayNights: number;
  quantity: number;
  currency: string;
  nightly: Array<{ date: string; amountMinor: string }>;
  charges: Array<{ id?: string; code: string; kind: string; calculation: string; amountMinor: string }>;
  addons: Array<{ id?: string; code: string; pricingModel: string; selectedQuantity: number; amountMinor: string }>;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  fingerprint: string;
};

export function serializePublicHospitalityQuote(quote: PublicHospitalityQuoteInput, holdExpiresAt: Date) {
  if (Number.isNaN(holdExpiresAt.getTime())) throw new TypeError('Hold expiry must be a valid date.');

  return Object.freeze({
    arrivalDate: quote.arrivalDate,
    departureDate: quote.departureDate,
    stayNights: quote.stayNights,
    quantity: quote.quantity,
    currency: quote.currency,
    nightly: quote.nightly.map((night) => ({ date: night.date, amountMinor: night.amountMinor })),
    charges: quote.charges.map((charge) => ({
      code: charge.code,
      kind: charge.kind,
      calculation: charge.calculation,
      amountMinor: charge.amountMinor,
    })),
    addons: quote.addons.map((addon) => ({
      code: addon.code,
      pricingModel: addon.pricingModel,
      selectedQuantity: addon.selectedQuantity,
      amountMinor: addon.amountMinor,
    })),
    accommodationSubtotalMinor: quote.accommodationSubtotalMinor,
    taxTotalMinor: quote.taxTotalMinor,
    feeTotalMinor: quote.feeTotalMinor,
    addonTotalMinor: quote.addonTotalMinor,
    totalMinor: quote.totalMinor,
    pricingFingerprint: quote.fingerprint,
    holdExpiresAt: holdExpiresAt.toISOString(),
  });
}
