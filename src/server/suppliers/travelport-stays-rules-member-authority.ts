import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_TERMS_BLOCKS = 8;
const MAX_PAYMENT_CARDS = 32;
const MAX_TEXT_BLOCKS = 64;
const MAX_TEXT_FORMATTED = 8;
const PAYMENT_CARD_CODE_LENGTH = 2;
const PAYMENT_CARD_CODE_PATTERN = /^[A-Z0-9]{2}$/;
const MAX_RULE_TEXT = 2_000;
const MAX_RAW_TEXT_MULTIPLIER = 4;

type RecordValue = Readonly<Record<string, unknown>>;

function invalidResponse(message = 'Travelport returned invalid Rules member authority evidence.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function boundedArray(value: unknown, max: number): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) invalidResponse();
  return value;
}

function requiredMachineString(value: unknown, max: number, label: string): void {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    invalidResponse(`Travelport returned incomplete ${label} authority evidence.`);
  }
}

function requiredPaymentCardCode(value: unknown): void {
  requiredMachineString(value, PAYMENT_CARD_CODE_LENGTH, 'accepted-card code');
  if (
    typeof value !== 'string'
    || value.length !== PAYMENT_CARD_CODE_LENGTH
    || !PAYMENT_CARD_CODE_PATTERN.test(value)
  ) {
    invalidResponse('Travelport returned invalid accepted-card code authority evidence.');
  }
}

function requiredCommercialText(value: unknown, max: number, label: string): void {
  if (typeof value !== 'string' || ASCII_CONTROL_PATTERN.test(value)) {
    invalidResponse(`Travelport returned incomplete ${label} authority evidence.`);
  }
  if (value.length > max * MAX_RAW_TEXT_MULTIPLIER) {
    invalidResponse(`Travelport returned oversized ${label} authority evidence.`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    invalidResponse(`Travelport returned incomplete ${label} authority evidence.`);
  }
  if (normalized.length > max) {
    invalidResponse(`Travelport returned ${label} authority evidence that would be truncated.`);
  }
}

function validateTermsMemberAuthority(value: unknown): void {
  const terms = record(value);
  if (!terms) invalidResponse();

  for (const cardValue of boundedArray(terms.AcceptedCreditCard, MAX_PAYMENT_CARDS)) {
    const card = record(cardValue);
    if (!card) invalidResponse();
    requiredPaymentCardCode(card.value);
  }

  for (const textBlockValue of boundedArray(terms.TextBlock, MAX_TEXT_BLOCKS)) {
    const textBlock = record(textBlockValue);
    if (!textBlock) invalidResponse();
    if (
      !Array.isArray(textBlock.TextFormatted)
      || textBlock.TextFormatted.length < 1
      || textBlock.TextFormatted.length > MAX_TEXT_FORMATTED
    ) {
      invalidResponse('Travelport returned incomplete Rules formatted-text authority evidence.');
    }
    for (const formattedValue of textBlock.TextFormatted) {
      const formatted = record(formattedValue);
      if (!formatted) invalidResponse();
      requiredCommercialText(formatted.value, MAX_RULE_TEXT, 'Rules formatted-text');
    }
  }
}

export function assertTravelportStaysRulesMemberAuthorityResponse(value: unknown): void {
  const root = record(value);
  const response = root ? record(root.OfferHospitalityResponse) : null;
  if (!response) return;

  const rawOffers = response.Offer;
  const offers = Array.isArray(rawOffers)
    ? rawOffers
    : rawOffers === undefined || rawOffers === null
      ? []
      : [rawOffers];
  if (offers.length > 1) invalidResponse();

  for (const offerValue of offers) {
    const offer = record(offerValue);
    if (!offer) invalidResponse();
    for (const termsValue of boundedArray(offer.TermsAndConditionsFull, MAX_TERMS_BLOCKS)) {
      validateTermsMemberAuthority(termsValue);
    }
  }
}

export function createTravelportStaysRulesMemberAuthorityFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchImpl(input, init);
    if (!response.ok) return response;

    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    assertTravelportStaysRulesMemberAuthorityResponse(payload);
    return response;
  }) as typeof fetch;
}
