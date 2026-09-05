import { createHash, randomUUID } from 'node:crypto';

import { moneyMinorToMajorString, normalizeCurrency, parseMoneyMajorToMinor, PricingValidationError } from '../pricing/money.ts';
import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierMoney,
  type HospitalitySupplierOfferRevalidationInput,
  type HospitalitySupplierPaymentTiming,
  type HospitalitySupplierPricingProvider,
} from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierBookingTerms,
  HospitalitySupplierBookingTermsProvider,
  HospitalitySupplierBookingTermsResult,
  HospitalitySupplierCancellationRule,
  HospitalitySupplierDepositRule,
  HospitalitySupplierRuleGuaranteeType,
  HospitalitySupplierRuleText,
} from './hospitality-supplier-booking-terms.ts';
import {
  requestTravelportStaysAccessToken,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': Object.freeze({
    staysV11: 'https://api.pp.travelport.net/11/hotel/',
    staysV12: 'https://api.pp.travelport.net/12/hotel/',
  }),
  production: Object.freeze({
    staysV11: 'https://api.travelport.net/11/hotel/',
    staysV12: 'https://api.travelport.net/12/hotel/',
  }),
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REFERENCE_LENGTH = 4_096;
const MAX_PROVIDER_TEXT = 2_000;
const MAX_ROOM_TYPES = 128;
const MAX_RATES_PER_ROOM = 256;
const MAX_TERMS_BLOCKS = 8;
const MAX_GUARANTEES = 16;
const MAX_CANCELLATION_RULES = 32;
const MAX_DEPOSITS = 16;
const MAX_PAYMENT_CARDS = 32;
const MAX_TEXT_BLOCKS = 64;
const MAX_TEXT_FORMATTED = 8;

const rulesTokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const rulesTokenRequests = new Map<string, Promise<string>>();

type TravelportPropertyIdentity = Readonly<{
  chainCode: string;
  propertyCode: string;
  authority: 'TVPT';
}>;

type TravelportOfferIdentity = Readonly<{
  property: TravelportPropertyIdentity;
  rateValue: string;
  rateAuthority: 'TVPT' | 'BKNG';
}>;

type TravelportRulesBridge = Readonly<{
  bookingCode: string;
  rateCandidate: Readonly<{
    rateCode?: string;
    rateID?: string;
    rateCategory?: string;
    chainCode: string;
    propertyCode: string;
  }> | null;
}>;

function normalizeTimeout(value: number | undefined) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport timeout is invalid.');
  }
  return timeoutMs;
}

async function fetchWithTimeout(input: {
  fetchImpl: typeof fetch;
  url: string;
  init: RequestInit;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    return await input.fetchImpl(input.url, { ...input.init, signal: controller.signal });
  } catch {
    throw new HospitalitySupplierProviderError(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

function providerFailureForStatus(status: number) {
  if (status === 401 || status === 403) return new HospitalitySupplierProviderError('AUTHENTICATION_FAILED');
  if (status === 429) return new HospitalitySupplierProviderError('RATE_LIMITED');
  if (status >= 500) return new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE');
  return new HospitalitySupplierProviderError('INVALID_RESPONSE');
}

async function loadRulesAccessToken(input: {
  cacheKey: string;
  credentials: TravelportStaysCredentials;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  nowMs: number;
}) {
  const cached = rulesTokenCache.get(input.cacheKey);
  if (cached && cached.expiresAtMs > input.nowMs) return cached.accessToken;
  const pending = rulesTokenRequests.get(input.cacheKey);
  if (pending) return pending;

  const request = requestTravelportStaysAccessToken({
    credentials: input.credentials,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    nowMs: input.nowMs,
  }).then((token) => {
    rulesTokenCache.set(input.cacheKey, Object.freeze({ accessToken: token.accessToken, expiresAtMs: token.expiresAtMs }));
    return token.accessToken;
  }).finally(() => rulesTokenRequests.delete(input.cacheKey));

  rulesTokenRequests.set(input.cacheKey, request);
  return request;
}

function decodeReference(value: unknown): unknown {
  if (typeof value !== 'string' || !value || value.length > MAX_REFERENCE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
}

function decodePropertyReference(value: unknown): TravelportPropertyIdentity {
  const decoded = decodeReference(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  const property = decoded as { chainCode?: unknown; propertyCode?: unknown; authority?: unknown };
  const chainCode = typeof property.chainCode === 'string' ? property.chainCode.trim() : '';
  const propertyCode = typeof property.propertyCode === 'string' ? property.propertyCode.trim() : '';
  if (property.authority !== 'TVPT' || !/^[A-Za-z0-9]{1,16}$/.test(chainCode) || !/^[A-Za-z0-9]{1,32}$/.test(propertyCode)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  return Object.freeze({ chainCode, propertyCode, authority: 'TVPT' });
}

function decodeOfferReference(value: unknown): TravelportOfferIdentity {
  const decoded = decodeReference(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  const offer = decoded as {
    chainCode?: unknown;
    propertyCode?: unknown;
    propertyAuthority?: unknown;
    rateValue?: unknown;
    rateAuthority?: unknown;
  };
  const property = decodePropertyReference(Buffer.from(JSON.stringify({
    chainCode: offer.chainCode,
    propertyCode: offer.propertyCode,
    authority: offer.propertyAuthority,
  }), 'utf8').toString('base64url'));
  if ((offer.rateAuthority !== 'TVPT' && offer.rateAuthority !== 'BKNG') || typeof offer.rateValue !== 'string') {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  const rateValue = offer.rateValue.trim();
  if (!rateValue || rateValue.length > MAX_REFERENCE_LENGTH || /[\r\n]/.test(rateValue)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  return Object.freeze({ property, rateValue, rateAuthority: offer.rateAuthority });
}

function normalizeLocalDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return value;
}

function normalizeInput(input: HospitalitySupplierOfferRevalidationInput) {
  const property = decodePropertyReference(input.supplierPropertyReference);
  const offer = decodeOfferReference(input.supplierOfferReference);
  if (
    offer.property.chainCode !== property.chainCode
    || offer.property.propertyCode !== property.propertyCode
    || offer.property.authority !== property.authority
  ) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer does not belong to the selected property.');
  }
  const checkInDateLocal = normalizeLocalDate(input.checkInDateLocal, 'Check-in date');
  const checkOutDateLocal = normalizeLocalDate(input.checkOutDateLocal, 'Check-out date');
  if (checkOutDateLocal <= checkInDateLocal) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Check-out must be after check-in.');
  if (input.rooms !== 1) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport Rules review currently supports one room per selected offer.');
  }
  if (!Number.isInteger(input.adults) || input.adults < 1) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Adult count is invalid.');
  const childAges = input.childAges ? [...input.childAges] : [];
  if (childAges.length > 8 || childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Child ages are invalid.');
  }
  const numberOfGuests = input.adults + childAges.length;
  if (numberOfGuests < 1 || numberOfGuests > 9) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport Rules supports between one and nine guests for this request.');
  }
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Offer currency is invalid.');
  }
  if (typeof input.expectedTotalMinor !== 'bigint' || input.expectedTotalMinor < 0n) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Expected offer total is invalid.');
  }
  if (typeof input.expectedOfferFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedOfferFingerprint)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Expected offer fingerprint is invalid.');
  }
  return Object.freeze({
    property,
    offer,
    checkInDateLocal,
    checkOutDateLocal,
    rooms: 1,
    adults: input.adults,
    childAges: Object.freeze(childAges),
    numberOfGuests,
    currency,
    expectedTotalMinor: input.expectedTotalMinor,
  });
}

function boundedText(value: unknown, max = MAX_PROVIDER_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function boundedProviderValue(value: unknown, max = 512) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) return null;
  return normalized;
}

function parseProviderMoney(value: unknown, currency: string) {
  const amount = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!amount) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  try {
    return parseMoneyMajorToMinor(amount, currency).amountMinor;
  } catch (error) {
    if (error instanceof PricingValidationError) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    throw error;
  }
}

function normalizeYesNo(value: unknown): boolean | null {
  if (value === true || value === 'Yes') return true;
  if (value === false || value === 'No') return false;
  return null;
}

function normalizePaymentTiming(value: unknown): HospitalitySupplierPaymentTiming {
  if (value === 'PrePay') return 'PREPAY';
  if (value === 'PostPay') return 'POSTPAY';
  return 'UNKNOWN';
}

function normalizeGuaranteeType(value: unknown): HospitalitySupplierRuleGuaranteeType {
  const mapping: Record<string, HospitalitySupplierRuleGuaranteeType> = {
    PrepayRequired: 'PREPAY_REQUIRED',
    DepositRequired: 'DEPOSIT_REQUIRED',
    GuaranteesNotRequired: 'GUARANTEES_NOT_REQUIRED',
    Profile: 'PROFILE',
    DepositNotRequired: 'DEPOSIT_NOT_REQUIRED',
    NoGuaranteesAccepted: 'NO_GUARANTEES_ACCEPTED',
    GuaranteeRequired: 'GUARANTEE_REQUIRED',
    'CC/DC/Voucher': 'CREDIT_DEBIT_VOUCHER',
    PrepayNotRequired: 'PREPAY_NOT_REQUIRED',
    GuaranteesAccepted: 'GUARANTEES_ACCEPTED',
    NoDepositsAccepted: 'NO_DEPOSITS_ACCEPTED',
  };
  return typeof value === 'string' ? mapping[value] ?? 'UNKNOWN' : 'UNKNOWN';
}

function normalizeDecimalText(value: unknown, label: string) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE', `${label} is invalid.`);
  return text;
}

function normalizeDateIfPresent(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeLocalDate(value, 'Provider rule date');
}

function normalizeTimeIfPresent(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return value;
}

function normalizePenalty(value: unknown): HospitalitySupplierCancellationRule['penalty'] {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const penalty = value as { '@type'?: unknown; Amount?: unknown; Percent?: unknown; Nights?: unknown; subjectToTax?: unknown };
  if (penalty['@type'] === 'HotelPenaltyAmount') {
    const amounts = Array.isArray(penalty.Amount) ? penalty.Amount : penalty.Amount ? [penalty.Amount] : [];
    if (amounts.length !== 1 || !amounts[0] || typeof amounts[0] !== 'object' || Array.isArray(amounts[0])) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    const amount = amounts[0] as { code?: unknown; value?: unknown };
    if (typeof amount.code !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    let currency: string;
    try {
      currency = normalizeCurrency(amount.code);
    } catch {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    return Object.freeze({ kind: 'AMOUNT', money: Object.freeze({ currency, amountMinor: parseProviderMoney(amount.value, currency) }) });
  }
  if (penalty['@type'] === 'HotelPenaltyPercent') {
    return Object.freeze({ kind: 'PERCENT', percent: normalizeDecimalText(penalty.Percent, 'Penalty percent') });
  }
  if (penalty['@type'] === 'HotelPenaltyNights') {
    const subjectToTax = penalty.subjectToTax === 'Yes' ? 'YES' : penalty.subjectToTax === 'No' ? 'NO' : 'UNKNOWN';
    return Object.freeze({ kind: 'NIGHTS', nights: normalizeDecimalText(penalty.Nights, 'Penalty nights'), subjectToTax });
  }
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport returned an unsupported cancellation penalty type.');
}

function normalizeCancellationRule(value: unknown): HospitalitySupplierCancellationRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const rule = value as { Refundable?: unknown; Description?: unknown; Deadline?: unknown; HotelPenalty?: unknown };
  let deadline: HospitalitySupplierCancellationRule['deadline'] = null;
  if (rule.Deadline !== undefined && rule.Deadline !== null) {
    if (!rule.Deadline || typeof rule.Deadline !== 'object' || Array.isArray(rule.Deadline)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const providerDeadline = rule.Deadline as { SpecificDate?: unknown; Time?: unknown };
    let specificDate: string | null = null;
    let startDate: string | null = null;
    let endDate: string | null = null;
    if (providerDeadline.SpecificDate !== undefined && providerDeadline.SpecificDate !== null) {
      if (!providerDeadline.SpecificDate || typeof providerDeadline.SpecificDate !== 'object' || Array.isArray(providerDeadline.SpecificDate)) {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      }
      const dates = providerDeadline.SpecificDate as { specific?: unknown; start?: unknown; end?: unknown };
      specificDate = normalizeDateIfPresent(dates.specific);
      startDate = normalizeDateIfPresent(dates.start);
      endDate = normalizeDateIfPresent(dates.end);
    }
    deadline = Object.freeze({ specificDate, startDate, endDate, timeLocal: normalizeTimeIfPresent(providerDeadline.Time) });
  }
  return Object.freeze({
    refundable: normalizeYesNo(rule.Refundable),
    description: boundedText(rule.Description, 1_000),
    deadline,
    penalty: normalizePenalty(rule.HotelPenalty),
  });
}

function normalizeDeposit(value: unknown): HospitalitySupplierDepositRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const deposit = value as { remainderInd?: unknown; Date?: unknown; CurrencyAmount?: unknown };
  let money: HospitalitySupplierMoney | null = null;
  if (deposit.CurrencyAmount !== undefined && deposit.CurrencyAmount !== null) {
    if (!deposit.CurrencyAmount || typeof deposit.CurrencyAmount !== 'object' || Array.isArray(deposit.CurrencyAmount)) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    const amount = deposit.CurrencyAmount as { code?: unknown; value?: unknown };
    if (typeof amount.code !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    let currency: string;
    try {
      currency = normalizeCurrency(amount.code);
    } catch {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    money = Object.freeze({ currency, amountMinor: parseProviderMoney(amount.value, currency) });
  }
  return Object.freeze({
    remainder: typeof deposit.remainderInd === 'boolean' ? deposit.remainderInd : null,
    dueDateLocal: normalizeDateIfPresent(deposit.Date),
    money,
  });
}

function normalizeTextBlocks(value: unknown): readonly HospitalitySupplierRuleText[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_TEXT_BLOCKS) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const output: HospitalitySupplierRuleText[] = [];
  for (const block of value) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const providerBlock = block as { title?: unknown; TextFormatted?: unknown };
    if (!Array.isArray(providerBlock.TextFormatted) || providerBlock.TextFormatted.length > MAX_TEXT_FORMATTED) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    for (const formatted of providerBlock.TextFormatted) {
      if (!formatted || typeof formatted !== 'object' || Array.isArray(formatted)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      const text = boundedText((formatted as { value?: unknown }).value);
      if (!text) continue;
      output.push(Object.freeze({
        title: boundedText(providerBlock.title, 120),
        language: boundedProviderValue((formatted as { language?: unknown }).language, 16),
        text,
      }));
      if (output.length > MAX_TEXT_BLOCKS * MAX_TEXT_FORMATTED) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
  }
  return Object.freeze(output);
}

function fingerprintTerms(value: Omit<HospitalitySupplierBookingTerms, 'termsFingerprint'>) {
  const payload = {
    ...value,
    price: {
      ...value.price,
      baseMinor: value.price.baseMinor?.toString() ?? null,
      taxMinor: value.price.taxMinor?.toString() ?? null,
      feeMinor: value.price.feeMinor?.toString() ?? null,
      totalMinor: value.price.totalMinor.toString(),
    },
    cancellationRules: value.cancellationRules.map((rule) => ({
      ...rule,
      penalty: rule.penalty?.kind === 'AMOUNT'
        ? { kind: 'AMOUNT', money: { currency: rule.penalty.money.currency, amountMinor: rule.penalty.money.amountMinor.toString() } }
        : rule.penalty,
    })),
    deposits: value.deposits.map((deposit) => ({
      ...deposit,
      money: deposit.money ? { currency: deposit.money.currency, amountMinor: deposit.money.amountMinor.toString() } : null,
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeRulesResponse(input: {
  value: unknown;
  supplierPropertyReference: string;
  supplierOfferReference: string;
  expectedProperty: TravelportPropertyIdentity;
  expectedBookingCode: string;
  expectedCheckInDateLocal: string;
  expectedCheckOutDateLocal: string;
  expectedCurrency: string;
  expectedTotalMinor: bigint;
  observedAt: string;
}): HospitalitySupplierBookingTerms {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const root = (input.value as { OfferHospitalityResponse?: unknown }).OfferHospitalityResponse;
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const offerValue = (root as { Offer?: unknown }).Offer;
  const offer = Array.isArray(offerValue) ? (offerValue.length === 1 ? offerValue[0] : null) : offerValue;
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const providerOffer = offer as { Product?: unknown; Price?: unknown; TermsAndConditionsFull?: unknown };

  if (!Array.isArray(providerOffer.Product) || providerOffer.Product.length < 1 || providerOffer.Product.length > 8) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const product = providerOffer.Product.find((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const property = (candidate as { PropertyKey?: unknown }).PropertyKey;
    return !!property && typeof property === 'object' && !Array.isArray(property)
      && (property as { chainCode?: unknown }).chainCode === input.expectedProperty.chainCode
      && (property as { propertyCode?: unknown }).propertyCode === input.expectedProperty.propertyCode;
  });
  if (!product || typeof product !== 'object' || Array.isArray(product)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const productValue = product as { bookingCode?: unknown; DateRange?: unknown };
  if (productValue.bookingCode !== input.expectedBookingCode) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  if (!productValue.DateRange || typeof productValue.DateRange !== 'object' || Array.isArray(productValue.DateRange)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const dates = productValue.DateRange as { start?: unknown; end?: unknown };
  if (dates.start !== input.expectedCheckInDateLocal || dates.end !== input.expectedCheckOutDateLocal) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

  if (!providerOffer.Price || typeof providerOffer.Price !== 'object' || Array.isArray(providerOffer.Price)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const price = providerOffer.Price as { CurrencyCode?: unknown; Base?: unknown; TotalTaxes?: unknown; TotalFees?: unknown; TotalPrice?: unknown };
  if (!price.CurrencyCode || typeof price.CurrencyCode !== 'object' || Array.isArray(price.CurrencyCode)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const currencyValue = (price.CurrencyCode as { value?: unknown }).value;
  if (typeof currencyValue !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  let currency: string;
  try {
    currency = normalizeCurrency(currencyValue);
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (currency !== input.expectedCurrency) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const totalMinor = parseProviderMoney(price.TotalPrice, currency);
  if (totalMinor !== input.expectedTotalMinor) throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport Rules returned a different total than the revalidated offer.');
  const optionalMoney = (value: unknown) => value === undefined || value === null ? null : parseProviderMoney(value, currency);

  if (!Array.isArray(providerOffer.TermsAndConditionsFull) || providerOffer.TermsAndConditionsFull.length < 1 || providerOffer.TermsAndConditionsFull.length > MAX_TERMS_BLOCKS) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const guarantees: HospitalitySupplierRuleGuaranteeType[] = [];
  const cancellations: HospitalitySupplierCancellationRule[] = [];
  const deposits: HospitalitySupplierDepositRule[] = [];
  const cards = new Set<string>();
  const texts: HospitalitySupplierRuleText[] = [];
  let paymentTiming: HospitalitySupplierPaymentTiming = 'UNKNOWN';
  let customerLoyaltyRequiredAtReservation: boolean | null = null;
  let qualificationRequiredAtCheckIn: boolean | null = null;
  let checkInTimeLocal: string | null = null;
  let checkOutTimeLocal: string | null = null;

  for (const terms of providerOffer.TermsAndConditionsFull) {
    if (!terms || typeof terms !== 'object' || Array.isArray(terms)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const block = terms as {
      RatePaymentInfo?: unknown;
      CustomerLoyaltyIDRequiredAtReservation?: unknown;
      RateQualificationIDRequiredAtCheckIn?: unknown;
      Guarantee?: unknown;
      CancelPenalty?: unknown;
      DepositPolicy?: unknown;
      AcceptedCreditCard?: unknown;
      TextBlock?: unknown;
      CheckInOutPolicy?: unknown;
    };
    const normalizedPayment = normalizePaymentTiming(block.RatePaymentInfo);
    if (normalizedPayment !== 'UNKNOWN') {
      if (paymentTiming !== 'UNKNOWN' && paymentTiming !== normalizedPayment) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      paymentTiming = normalizedPayment;
    }
    const loyalty = typeof block.CustomerLoyaltyIDRequiredAtReservation === 'boolean' ? block.CustomerLoyaltyIDRequiredAtReservation : null;
    if (loyalty !== null) {
      if (customerLoyaltyRequiredAtReservation !== null && customerLoyaltyRequiredAtReservation !== loyalty) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      customerLoyaltyRequiredAtReservation = loyalty;
    }
    const qualification = typeof block.RateQualificationIDRequiredAtCheckIn === 'boolean' ? block.RateQualificationIDRequiredAtCheckIn : null;
    if (qualification !== null) {
      if (qualificationRequiredAtCheckIn !== null && qualificationRequiredAtCheckIn !== qualification) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      qualificationRequiredAtCheckIn = qualification;
    }

    if (block.Guarantee !== undefined) {
      if (!Array.isArray(block.Guarantee) || block.Guarantee.length > MAX_GUARANTEES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      for (const guarantee of block.Guarantee) {
        if (!guarantee || typeof guarantee !== 'object' || Array.isArray(guarantee)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
        guarantees.push(normalizeGuaranteeType((guarantee as { guaranteeType?: unknown }).guaranteeType));
        if (guarantees.length > MAX_GUARANTEES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      }
    }
    if (block.CancelPenalty !== undefined) {
      if (!Array.isArray(block.CancelPenalty) || block.CancelPenalty.length > MAX_CANCELLATION_RULES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      cancellations.push(...block.CancelPenalty.map(normalizeCancellationRule));
      if (cancellations.length > MAX_CANCELLATION_RULES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    if (block.DepositPolicy !== undefined && block.DepositPolicy !== null) {
      const policies = Array.isArray(block.DepositPolicy) ? block.DepositPolicy : [block.DepositPolicy];
      for (const policy of policies) {
        if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
        const depositValue = (policy as { Deposit?: unknown }).Deposit;
        if (depositValue === undefined || depositValue === null) continue;
        const providerDeposits = Array.isArray(depositValue) ? depositValue : [depositValue];
        for (const deposit of providerDeposits) {
          deposits.push(normalizeDeposit(deposit));
          if (deposits.length > MAX_DEPOSITS) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
        }
      }
    }
    if (block.AcceptedCreditCard !== undefined) {
      if (!Array.isArray(block.AcceptedCreditCard) || block.AcceptedCreditCard.length > MAX_PAYMENT_CARDS) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      for (const card of block.AcceptedCreditCard) {
        if (!card || typeof card !== 'object' || Array.isArray(card)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
        const code = boundedProviderValue((card as { value?: unknown }).value, 16);
        if (code) cards.add(code);
      }
    }
    texts.push(...normalizeTextBlocks(block.TextBlock));
    if (texts.length > MAX_TEXT_BLOCKS * MAX_TEXT_FORMATTED) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

    if (block.CheckInOutPolicy !== undefined && block.CheckInOutPolicy !== null) {
      if (!block.CheckInOutPolicy || typeof block.CheckInOutPolicy !== 'object' || Array.isArray(block.CheckInOutPolicy)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      const policy = block.CheckInOutPolicy as { checkInTime?: unknown; checkOutTime?: unknown };
      const inTime = normalizeTimeIfPresent(policy.checkInTime);
      const outTime = normalizeTimeIfPresent(policy.checkOutTime);
      if (inTime) {
        if (checkInTimeLocal && checkInTimeLocal !== inTime) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
        checkInTimeLocal = inTime;
      }
      if (outTime) {
        if (checkOutTimeLocal && checkOutTimeLocal !== outTime) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
        checkOutTimeLocal = outTime;
      }
    }
  }

  const uniqueGuarantees = Object.freeze([...new Set(guarantees)]);
  const acceptedPaymentCardCodes = Object.freeze([...cards].sort());
  const completeForReservationReview = uniqueGuarantees.length > 0
    && !uniqueGuarantees.includes('UNKNOWN')
    && cancellations.length > 0;

  const normalized: Omit<HospitalitySupplierBookingTerms, 'termsFingerprint'> = Object.freeze({
    supplierPropertyReference: input.supplierPropertyReference,
    supplierOfferReference: input.supplierOfferReference,
    observedAt: input.observedAt,
    price: Object.freeze({
      currency,
      baseMinor: optionalMoney(price.Base),
      taxMinor: optionalMoney(price.TotalTaxes),
      feeMinor: optionalMoney(price.TotalFees),
      totalMinor,
    }),
    paymentTiming,
    guaranteeTypes: uniqueGuarantees,
    customerLoyaltyRequiredAtReservation,
    qualificationRequiredAtCheckIn,
    acceptedPaymentCardCodes,
    cancellationRules: Object.freeze(cancellations),
    deposits: Object.freeze(deposits),
    checkInTimeLocal,
    checkOutTimeLocal,
    textRules: Object.freeze(texts),
    completeForReservationReview,
    revalidationRequired: true,
  });
  return Object.freeze({ ...normalized, termsFingerprint: fingerprintTerms(normalized) });
}

function readBridgeResponse(input: {
  value: unknown;
  property: TravelportPropertyIdentity;
  offer: TravelportOfferIdentity;
  currency: string;
  expectedTotalMinor: bigint;
}): TravelportRulesBridge {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const hotelsResponse = (input.value as { hotelsResponse?: unknown }).hotelsResponse;
  if (!hotelsResponse || typeof hotelsResponse !== 'object' || Array.isArray(hotelsResponse)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const propertyItems = (hotelsResponse as { propertyItems?: unknown }).propertyItems;
  if (!Array.isArray(propertyItems) || propertyItems.length !== 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const property = propertyItems[0];
  if (!property || typeof property !== 'object' || Array.isArray(property)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  if ((property as { chainCode?: unknown }).chainCode !== input.property.chainCode || (property as { propertyCode?: unknown }).propertyCode !== input.property.propertyCode) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const roomTypes = (property as { roomTypes?: unknown }).roomTypes;
  if (!Array.isArray(roomTypes) || roomTypes.length > MAX_ROOM_TYPES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const matches: Array<Record<string, unknown>> = [];
  for (const room of roomTypes) {
    if (!room || typeof room !== 'object' || Array.isArray(room)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const rates = (room as { rates?: unknown }).rates;
    if (!Array.isArray(rates) || rates.length > MAX_RATES_PER_ROOM) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    for (const rate of rates) {
      if (!rate || typeof rate !== 'object' || Array.isArray(rate)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      const key = (rate as { rateKey?: unknown }).rateKey;
      if (!key || typeof key !== 'object' || Array.isArray(key)) continue;
      if ((key as { value?: unknown }).value === input.offer.rateValue && (key as { authority?: unknown }).authority === input.offer.rateAuthority) matches.push(rate as Record<string, unknown>);
    }
  }
  if (matches.length !== 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const rate = matches[0]!;
  const bookingCode = boundedProviderValue(rate.bookingCode, 512);
  if (!bookingCode) throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport did not return the booking code required for Rules.');
  const price = rate.price;
  if (!price || typeof price !== 'object' || Array.isArray(price)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const currencyCode = (price as { currencyCode?: unknown }).currencyCode;
  if (typeof currencyCode !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  let currency: string;
  try {
    currency = normalizeCurrency(currencyCode);
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (currency !== input.currency) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const totalPrice = (price as { totalPrice?: unknown }).totalPrice;
  if (!totalPrice || typeof totalPrice !== 'object' || Array.isArray(totalPrice)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  if (parseProviderMoney((totalPrice as { amount?: unknown }).amount, currency) !== input.expectedTotalMinor) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport offer changed while Rules authority was being prepared.');
  }

  let rateCandidate: TravelportRulesBridge['rateCandidate'] = null;
  if (rate.rateCodeInfo !== undefined && rate.rateCodeInfo !== null) {
    if (!rate.rateCodeInfo || typeof rate.rateCodeInfo !== 'object' || Array.isArray(rate.rateCodeInfo)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const info = rate.rateCodeInfo as { rateCode?: unknown; ratePlanID?: unknown; rateCategory?: unknown };
    const rateCode = boundedProviderValue(info.rateCode, 256);
    const rateID = boundedProviderValue(info.ratePlanID, 256);
    const rateCategory = boundedProviderValue(info.rateCategory, 128);
    if (rateCode || rateID || rateCategory) {
      rateCandidate = Object.freeze({
        ...(rateCode ? { rateCode } : {}),
        ...(rateID ? { rateID } : {}),
        ...(rateCategory ? { rateCategory } : {}),
        chainCode: input.property.chainCode,
        propertyCode: input.property.propertyCode,
      });
    }
  }
  return Object.freeze({ bookingCode, rateCandidate });
}

export class TravelportStaysBookingTermsProvider implements HospitalitySupplierBookingTermsProvider {
  readonly #credentials: TravelportStaysCredentials;
  readonly #cacheKey: string;
  readonly #pricingProvider: HospitalitySupplierPricingProvider;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(input: {
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    pricingProvider: HospitalitySupplierPricingProvider;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }) {
    if (!input.cacheKey || input.cacheKey.length > 512 || /[\r\n]/.test(input.cacheKey)) throw new HospitalitySupplierProviderError('INVALID_REQUEST');
    this.#credentials = input.credentials;
    this.#cacheKey = input.cacheKey;
    this.#pricingProvider = input.pricingProvider;
    this.#fetchImpl = input.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(input.timeoutMs);
    this.#now = input.now ?? (() => new Date());
  }

  async #accessToken() {
    return loadRulesAccessToken({
      cacheKey: this.#cacheKey,
      credentials: this.#credentials,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      nowMs: this.#now().getTime(),
    });
  }

  async #request(input: { url: string; body: unknown; freshPricing?: boolean }) {
    const response = await fetchWithTimeout({
      fetchImpl: this.#fetchImpl,
      url: input.url,
      timeoutMs: this.#timeoutMs,
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.#accessToken()}`,
          XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
          E2ETrackingID: `sf-${randomUUID()}`,
          username: this.#credentials.username,
          password: this.#credentials.password,
          client_id: this.#credentials.clientId,
          client_secret: this.#credentials.clientSecret,
          ...(input.freshPricing ? { 'TVP-Cache-Control': 'no-cache' } : {}),
        },
        body: JSON.stringify(input.body),
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) rulesTokenCache.delete(this.#cacheKey);
      throw providerFailureForStatus(response.status);
    }
    return response.json().catch(() => null);
  }

  async retrieveBookingTerms(input: HospitalitySupplierOfferRevalidationInput): Promise<HospitalitySupplierBookingTermsResult> {
    const normalized = normalizeInput(input);
    const endpoints = ENDPOINTS[this.#credentials.environment];
    const children = normalized.childAges.map((age) => ({ age }));
    const bridgePayload = await this.#request({
      url: `${endpoints.staysV12}search/searchcomplete`,
      freshPricing: true,
      body: {
        requestedCurrency: normalized.currency,
        stayDetails: {
          checkInDateLocal: normalized.checkInDateLocal,
          checkOutDateLocal: normalized.checkOutDateLocal,
          rooms: 1,
          guests: {
            adults: normalized.adults,
            ...(children.length > 0 ? { children } : {}),
          },
        },
        propertyFilter: {
          propertyKeys: [{
            chainCode: normalized.property.chainCode,
            propertyCode: normalized.property.propertyCode,
            authority: normalized.property.authority,
          }],
          returnOnlyAvailableProperties: true,
        },
        returnCompleteNightlyRateBreakdown: true,
      },
    });
    const bridge = readBridgeResponse({
      value: bridgePayload,
      property: normalized.property,
      offer: normalized.offer,
      currency: normalized.currency,
      expectedTotalMinor: normalized.expectedTotalMinor,
    });

    const guestCount = [
      { '@type': 'GuestCount', count: normalized.adults, ageQualifyingCode: '10' },
      ...normalized.childAges.map((age) => ({ '@type': 'GuestCount', count: 1, ageQualifyingCode: '8', age })),
    ];
    const rulesObservedAt = this.#now().toISOString();
    const rulesPayload = await this.#request({
      url: `${endpoints.staysV11}rules/offershospitality/buildfromrequest`,
      body: {
        OfferQueryHospitalityRequest: {
          bookingCode: bridge.bookingCode,
          requestedCurrency: normalized.currency,
          checkinDate: normalized.checkInDateLocal,
          checkoutDate: normalized.checkOutDateLocal,
          numberOfGuests: normalized.numberOfGuests,
          storedAmount: moneyMinorToMajorString(normalized.expectedTotalMinor, normalized.currency),
          storedCurrency: normalized.currency,
          HotelAggregator: normalized.offer.rateAuthority === 'TVPT' ? 'Travelport' : 'Booking',
          PropertyKey: {
            '@type': 'PropertyKey',
            chainCode: normalized.property.chainCode,
            propertyCode: normalized.property.propertyCode,
          },
          ...(bridge.rateCandidate ? { RateCandidate: { '@type': 'RateCandidateDetail', ...bridge.rateCandidate } } : {}),
          RoomStayCandidates: {
            '@type': 'RoomStayCandidates',
            RoomStayCandidate: [{
              '@type': 'RoomStayCandidate',
              GuestCounts: {
                '@type': 'GuestCounts',
                GuestCount: guestCount,
              },
            }],
          },
        },
      },
    });

    const terms = normalizeRulesResponse({
      value: rulesPayload,
      supplierPropertyReference: input.supplierPropertyReference,
      supplierOfferReference: input.supplierOfferReference,
      expectedProperty: normalized.property,
      expectedBookingCode: bridge.bookingCode,
      expectedCheckInDateLocal: normalized.checkInDateLocal,
      expectedCheckOutDateLocal: normalized.checkOutDateLocal,
      expectedCurrency: normalized.currency,
      expectedTotalMinor: normalized.expectedTotalMinor,
      observedAt: rulesObservedAt,
    });

    const finalRevalidation = await this.#pricingProvider.revalidatePropertyOffer(input);
    if (finalRevalidation.status !== 'UNCHANGED') {
      return Object.freeze({
        status: finalRevalidation.status,
        offer: finalRevalidation.offer,
        bookingTerms: null,
        observedAt: finalRevalidation.observedAt,
      });
    }
    return Object.freeze({
      status: 'READY',
      offer: finalRevalidation.offer,
      bookingTerms: terms,
      observedAt: finalRevalidation.observedAt,
    });
  }
}
