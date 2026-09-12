import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_TEXT_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const MONEY_TEXT_PATTERN = /^\d+(?:\.\d+)?$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const MAX_MONEY_TEXT_LENGTH = 128;
const MAX_DECIMAL_TEXT_LENGTH = 64;
const MAX_MACHINE_TOKEN_LENGTH = 128;
const MAX_ROOM_TYPES = 128;
const MAX_RATES_PER_ROOM = 256;
const MAX_CANCELLATION_PENALTIES = 32;
const MAX_TERMS_BLOCKS = 8;
const MAX_GUARANTEES = 16;
const MAX_DEPOSIT_POLICIES = 16;
const MAX_DEPOSITS = 16;
const MAX_PAYMENT_CARDS = 32;
const MAX_TEXT_BLOCKS = 64;
const MAX_TEXT_FORMATTED = 8;
const MAX_RULE_PRODUCTS = 8;
const MAX_CANCELLATION_DESCRIPTION = 1_000;
const MAX_SEARCH_TEXT = 512;
const MAX_RULE_TEXT = 2_000;
const MAX_TEXT_TITLE = 120;
const MAX_LANGUAGE_CODE = 16;
const MAX_RAW_TEXT_MULTIPLIER = 4;
const SEARCH_PRICE_CHANGE_PROBABILITIES = new Set(['High', 'Medium', 'Low']);
const SEARCH_PAYMENT_TIMINGS = new Set(['PrePay', 'PostPay', 'Unknown']);
const SEARCH_GUARANTEE_TYPES = new Set([
  'GuaranteeRequired',
  'NoGuaranteesAccepted',
  'DepositRequired',
  'PrepayRequired',
]);
const RULE_SUBJECT_TO_TAX = new Set(['Yes', 'No', 'Unknown']);
const RULE_PENALTY_TYPES = new Set([
  'HotelPenaltyAmount',
  'HotelPenaltyPercent',
  'HotelPenaltyNights',
]);

type RecordValue = Readonly<Record<string, unknown>>;

function invalidResponse(message = 'Travelport returned invalid commercial authority evidence.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function optionalRecord(value: unknown): RecordValue | null {
  if (value === undefined || value === null) return null;
  const object = record(value);
  if (!object) invalidResponse('Travelport returned malformed commercial authority structure.');
  return object;
}

function boundedArray(value: unknown, max: number): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalidResponse();
  if (value.length > max) invalidResponse('Travelport returned an oversized commercial authority collection.');
  return value;
}

function exactMachineStringIfPresent(value: unknown, max = MAX_MACHINE_TOKEN_LENGTH): void {
  if (value === undefined || value === null) return;
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    invalidResponse();
  }
}

function enumStringIfPresent(value: unknown, allowed: ReadonlySet<string>, label: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !allowed.has(value)) {
    invalidResponse(`Travelport returned unsupported ${label} authority evidence.`);
  }
}

function booleanIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'boolean') {
    invalidResponse('Travelport returned malformed boolean commercial authority evidence.');
  }
}

function yesNoIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (value === true || value === false || value === 'Yes' || value === 'No') return;
  invalidResponse('Travelport returned malformed refundable authority evidence.');
}

function localDateIfPresent(value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) invalidResponse();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalidResponse('Travelport returned an invalid local date.');
  }
}

function localTimeIfPresent(value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || !LOCAL_TIME_PATTERN.test(value)) {
    invalidResponse('Travelport returned an invalid local time.');
  }
}

function canonicalCurrencyIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !CURRENCY_CODE_PATTERN.test(value)) {
    invalidResponse('Travelport returned an invalid currency code.');
  }
}

function exactDecimalText(
  value: unknown,
  pattern: RegExp,
  max: number,
  message = 'Travelport returned invalid decimal authority evidence.',
): void {
  if (value === undefined || value === null) return;
  const text = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  if (
    !text
    || text.length > max
    || ASCII_CONTROL_PATTERN.test(text)
    || !pattern.test(text)
  ) {
    invalidResponse(message);
  }
}

function exactMoneyIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number' && value < 0) {
    invalidResponse('Travelport returned an invalid money value.');
  }
  exactDecimalText(
    value,
    MONEY_TEXT_PATTERN,
    MAX_MONEY_TEXT_LENGTH,
    'Travelport returned an invalid money value.',
  );
}

function exactDecimalIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number' && value < 0) invalidResponse();
  exactDecimalText(value, DECIMAL_TEXT_PATTERN, MAX_DECIMAL_TEXT_LENGTH);
}

function requiredDecimal(value: unknown, label: string): void {
  if (value === undefined || value === null) {
    invalidResponse(`Travelport returned incomplete ${label} authority evidence.`);
  }
  exactDecimalIfPresent(value);
}

function penaltyFieldAbsent(penalty: RecordValue, field: string, label: string): void {
  if (penalty[field] !== undefined && penalty[field] !== null) {
    invalidResponse(`Travelport returned contradictory ${label} authority evidence.`);
  }
}

function commercialTextIfPresent(value: unknown, max: number): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || ASCII_CONTROL_PATTERN.test(value)) invalidResponse();
  if (value.length > (max * MAX_RAW_TEXT_MULTIPLIER)) {
    invalidResponse('Travelport returned oversized commercial text evidence.');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > max) {
    invalidResponse('Travelport returned commercial text that would be truncated before authority fingerprinting.');
  }
}

function moneyComponent(value: unknown): void {
  if (value === undefined || value === null) return;
  const component = record(value);
  if (!component) invalidResponse();
  exactMoneyIfPresent(component.amount);
}

function searchCancellationPenalty(value: unknown): void {
  const penalty = record(value);
  if (!penalty) invalidResponse();
  commercialTextIfPresent(penalty.deadlineLocal, 100);
  booleanIfPresent(penalty.estimatedDeadlineLocal);
  commercialTextIfPresent(penalty.cancelShortDescription, MAX_SEARCH_TEXT);
  const providerPenalty = optionalRecord(penalty.penalty);
  if (!providerPenalty) return;
  booleanIfPresent(providerPenalty.estimatedAmount);
  const amount = optionalRecord(providerPenalty.currencyAmount);
  if (!amount) return;
  canonicalCurrencyIfPresent(amount.currency);
  exactMoneyIfPresent(amount.amount);
}

function searchRate(value: unknown): void {
  const rate = record(value);
  if (!rate) invalidResponse();
  commercialTextIfPresent(rate.rateDescription, 500);
  commercialTextIfPresent(rate.roomDescription, 500);
  for (const field of [
    'wifiIncluded',
    'breakfastIncluded',
    'lunchIncluded',
    'dinnerIncluded',
    'freeParkingIncluded',
    'valetParkingIncluded',
  ] as const) {
    booleanIfPresent(rate[field]);
  }
  enumStringIfPresent(rate.priceChangeProbability, SEARCH_PRICE_CHANGE_PROBABILITIES, 'price-change probability');

  const price = optionalRecord(rate.price);
  if (price) {
    canonicalCurrencyIfPresent(price.currencyCode);
    moneyComponent(price.base);
    moneyComponent(price.totalTaxes);
    moneyComponent(price.totalPrice);
    moneyComponent(price.totalIncludedFees);
    moneyComponent(price.totalFeesDueAtProperty);
    booleanIfPresent(price.taxesIncludedInBase);
    booleanIfPresent(price.resortFeeIncluded);
    booleanIfPresent(price.predictedPriceChangeDuringStay);
  }

  const terms = optionalRecord(rate.terms);
  if (!terms) return;
  enumStringIfPresent(terms.ratePaymentInfo, SEARCH_PAYMENT_TIMINGS, 'SearchComplete payment timing');
  enumStringIfPresent(terms.guaranteeType, SEARCH_GUARANTEE_TYPES, 'SearchComplete guarantee type');
  for (const field of [
    'partialTermsCache',
    'fullTermsCache',
    'paymentTypeEstimated',
    'freeCancellationWithin24Hours',
    'customerLoyaltyIDRequiredAtReservation',
    'rateQualificationIDRequiredAtCheckIn',
    'refundable',
  ] as const) {
    booleanIfPresent(terms[field]);
  }
  commercialTextIfPresent(terms.cancelNote, MAX_SEARCH_TEXT);
  for (const penalty of boundedArray(terms.cancelPenalties, MAX_CANCELLATION_PENALTIES)) {
    searchCancellationPenalty(penalty);
  }
}

export function assertTravelportStaysSearchCommercialAuthorityResponse(value: unknown): void {
  const root = record(value);
  const response = root ? record(root.hotelsResponse) : null;
  if (!response) return;
  for (const propertyValue of boundedArray(response.propertyItems, 100)) {
    const property = record(propertyValue);
    if (!property) invalidResponse();
    for (const roomValue of boundedArray(property.roomTypes, MAX_ROOM_TYPES)) {
      const room = record(roomValue);
      if (!room) invalidResponse();
      commercialTextIfPresent(room.shortRoomDescription, 500);
      for (const rateValue of boundedArray(room.rates, MAX_RATES_PER_ROOM)) searchRate(rateValue);
    }
  }
}

function rulesMoney(value: unknown): void {
  const amount = record(value);
  if (!amount) invalidResponse();
  canonicalCurrencyIfPresent(amount.code);
  exactMoneyIfPresent(amount.value);
}

function rulesPenalty(value: unknown): void {
  const penalty = record(value);
  if (!penalty) invalidResponse();
  const penaltyType = penalty['@type'];
  if (typeof penaltyType !== 'string' || !RULE_PENALTY_TYPES.has(penaltyType)) {
    invalidResponse('Travelport returned an unsupported Rules cancellation penalty type.');
  }

  if (penaltyType === 'HotelPenaltyAmount') {
    penaltyFieldAbsent(penalty, 'Percent', 'amount-penalty');
    penaltyFieldAbsent(penalty, 'Nights', 'amount-penalty');
    penaltyFieldAbsent(penalty, 'subjectToTax', 'amount-penalty');
    penaltyFieldAbsent(penalty, 'appliesTo', 'amount-penalty');
    const amounts = Array.isArray(penalty.Amount)
      ? boundedArray(penalty.Amount, 1)
      : penalty.Amount === undefined || penalty.Amount === null
        ? []
        : [penalty.Amount];
    if (amounts.length !== 1) {
      invalidResponse('Travelport returned incomplete amount-penalty authority evidence.');
    }
    rulesMoney(amounts[0]);
    return;
  }

  if (penaltyType === 'HotelPenaltyPercent') {
    penaltyFieldAbsent(penalty, 'Amount', 'percent-penalty');
    penaltyFieldAbsent(penalty, 'Nights', 'percent-penalty');
    penaltyFieldAbsent(penalty, 'subjectToTax', 'percent-penalty');
    requiredDecimal(penalty.Percent, 'percent-penalty');
    if (penalty.appliesTo !== undefined && penalty.appliesTo !== null && penalty.appliesTo !== 'Amount') {
      invalidResponse('Travelport returned unsupported percent-penalty appliesTo authority evidence.');
    }
    return;
  }

  penaltyFieldAbsent(penalty, 'Amount', 'nights-penalty');
  penaltyFieldAbsent(penalty, 'Percent', 'nights-penalty');
  penaltyFieldAbsent(penalty, 'appliesTo', 'nights-penalty');
  requiredDecimal(penalty.Nights, 'nights-penalty');
  enumStringIfPresent(penalty.subjectToTax, RULE_SUBJECT_TO_TAX, 'Rules cancellation tax treatment');
}

function rulesCancellation(value: unknown): void {
  const cancellation = record(value);
  if (!cancellation) invalidResponse();
  yesNoIfPresent(cancellation.Refundable);
  commercialTextIfPresent(cancellation.Description, MAX_CANCELLATION_DESCRIPTION);
  const deadline = optionalRecord(cancellation.Deadline);
  if (deadline) {
    const specificDate = optionalRecord(deadline.SpecificDate);
    if (specificDate) {
      localDateIfPresent(specificDate.specific);
      localDateIfPresent(specificDate.start);
      localDateIfPresent(specificDate.end);
    }
    localTimeIfPresent(deadline.Time);
  }
  const penalty = cancellation.HotelPenalty;
  if (penalty !== undefined && penalty !== null) rulesPenalty(penalty);
}

function rulesDeposit(value: unknown): void {
  const deposit = record(value);
  if (!deposit) invalidResponse();
  booleanIfPresent(deposit.remainderInd);
  localDateIfPresent(deposit.Date);
  const amount = deposit.CurrencyAmount;
  if (amount !== undefined && amount !== null) rulesMoney(amount);
}

function rulesTextBlock(value: unknown): void {
  const block = record(value);
  if (!block) invalidResponse();
  commercialTextIfPresent(block.title, MAX_TEXT_TITLE);
  for (const formattedValue of boundedArray(block.TextFormatted, MAX_TEXT_FORMATTED)) {
    const formatted = record(formattedValue);
    if (!formatted) invalidResponse();
    exactMachineStringIfPresent(formatted.language, MAX_LANGUAGE_CODE);
    commercialTextIfPresent(formatted.value, MAX_RULE_TEXT);
  }
}

function rulesTerms(value: unknown): void {
  const block = record(value);
  if (!block) invalidResponse();
  exactMachineStringIfPresent(block.RatePaymentInfo, 32);
  booleanIfPresent(block.CustomerLoyaltyIDRequiredAtReservation);
  booleanIfPresent(block.RateQualificationIDRequiredAtCheckIn);

  for (const guaranteeValue of boundedArray(block.Guarantee, MAX_GUARANTEES)) {
    const guarantee = record(guaranteeValue);
    if (!guarantee) invalidResponse();
    exactMachineStringIfPresent(guarantee.guaranteeType, 64);
  }
  for (const cancellation of boundedArray(block.CancelPenalty, MAX_CANCELLATION_PENALTIES)) {
    rulesCancellation(cancellation);
  }

  const policyValues = Array.isArray(block.DepositPolicy)
    ? boundedArray(block.DepositPolicy, MAX_DEPOSIT_POLICIES)
    : block.DepositPolicy === undefined || block.DepositPolicy === null
      ? []
      : [block.DepositPolicy];
  let depositCount = 0;
  for (const policyValue of policyValues) {
    const policy = record(policyValue);
    if (!policy) invalidResponse();
    const deposits = Array.isArray(policy.Deposit)
      ? boundedArray(policy.Deposit, MAX_DEPOSITS)
      : policy.Deposit === undefined || policy.Deposit === null
        ? []
        : [policy.Deposit];
    depositCount += deposits.length;
    if (depositCount > MAX_DEPOSITS) invalidResponse('Travelport returned too many deposit rules.');
    for (const deposit of deposits) rulesDeposit(deposit);
  }

  for (const cardValue of boundedArray(block.AcceptedCreditCard, MAX_PAYMENT_CARDS)) {
    const card = record(cardValue);
    if (!card) invalidResponse();
    exactMachineStringIfPresent(card.value, 16);
  }
  for (const textBlock of boundedArray(block.TextBlock, MAX_TEXT_BLOCKS)) rulesTextBlock(textBlock);

  const checkInOutPolicy = optionalRecord(block.CheckInOutPolicy);
  if (checkInOutPolicy) {
    localTimeIfPresent(checkInOutPolicy.checkInTime);
    localTimeIfPresent(checkInOutPolicy.checkOutTime);
  }
}

export function assertTravelportStaysRulesCommercialAuthorityResponse(value: unknown): void {
  const root = record(value);
  const response = root ? record(root.OfferHospitalityResponse) : null;
  if (!response) return;
  const rawOffers = response.Offer;
  const offers = Array.isArray(rawOffers)
    ? boundedArray(rawOffers, 1)
    : rawOffers === undefined || rawOffers === null
      ? []
      : [rawOffers];

  for (const offerValue of offers) {
    const offer = record(offerValue);
    if (!offer) invalidResponse();
    const price = optionalRecord(offer.Price);
    if (price) {
      const currencyCode = optionalRecord(price.CurrencyCode);
      if (currencyCode) canonicalCurrencyIfPresent(currencyCode.value);
      exactMoneyIfPresent(price.Base);
      exactMoneyIfPresent(price.TotalTaxes);
      exactMoneyIfPresent(price.TotalFees);
      exactMoneyIfPresent(price.TotalPrice);
    }

    for (const productValue of boundedArray(offer.Product, MAX_RULE_PRODUCTS)) {
      const product = record(productValue);
      if (!product) invalidResponse();
      exactMachineStringIfPresent(product.bookingCode, 512);
      const propertyKey = optionalRecord(product.PropertyKey);
      if (propertyKey) {
        exactMachineStringIfPresent(propertyKey.chainCode, 16);
        exactMachineStringIfPresent(propertyKey.propertyCode, 32);
      }
    }

    for (const terms of boundedArray(offer.TermsAndConditionsFull, MAX_TERMS_BLOCKS)) rulesTerms(terms);
  }
}
