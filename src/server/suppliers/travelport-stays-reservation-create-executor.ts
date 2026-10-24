import { readTravelportStaysCachedToken, storeTravelportStaysCachedToken } from './travelport-stays-access-token-cache.ts';
import { moneyMinorToMajorString } from '../pricing/money.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import {
  snapshotTravelportStaysReservationCreateRequestMaterial,
  snapshotTravelportStaysReservationPaymentAuthority,
  type TravelportStaysReservationCreateRequestMaterial,
} from './travelport-stays-reservation-create-request-material.ts';
import {
  classifyTravelportStaysReservationCreateOutcome,
  type TravelportStaysCreateExpectedReservation,
  type TravelportStaysReservationCreateOutcome,
} from './travelport-stays-reservation-create-outcome.ts';
import { materializeTravelportStaysReservationIoConstructorAuthority } from './travelport-stays-constructor-authority.ts';
import { materializeTravelportStaysCreateExpectedReservation } from './travelport-stays-reservation-expected-authority.ts';
import { materializeTravelportStaysReservationOperationInput } from './travelport-stays-reservation-operation-input-authority.ts';
import {
  requestTravelportStaysAccessToken,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';
import { assertTravelportStaysTransportRequestReady } from './travelport-stays-transport-preflight.ts';
import { snapshotTravelportStaysReservationPaymentCard } from './travelport-stays-reservation-payment-card-source.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': 'https://api.pp.travelport.net/11/hotel/',
  production: 'https://api.travelport.net/11/hotel/',
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CACHE_KEY_LENGTH = 512;
const MAX_CARD_HOLDER_NAME_LENGTH = 160;
const MAX_CARD_CODE_LENGTH = 2;
const MAX_PAYMENT_CARD_CODES = 32;
const MAX_BILLING_ADDRESS_LINE_LENGTH = 256;
const MAX_BILLING_CITY_LENGTH = 128;
const MAX_BILLING_STATE_LENGTH = 64;
const MAX_BILLING_POSTAL_CODE_LENGTH = 32;
const MAX_PAYMENT_PHONE_AREA_LENGTH = 16;
const MAX_PAYMENT_PHONE_NUMBER_LENGTH = 32;
const MAX_PAYMENT_PHONE_CITY_CODE_LENGTH = 8;
const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();
const CREATE_OPERATION_FIELDS = Object.freeze([
  'requestCorrelationId',
  'requestMaterial',
  'paymentAuthority',
  'acquirePaymentCard',
  'expectedReservation',
  'beforeProviderRequest',
] as const);
const REVIEWED_CREATE_OPERATION_FIELDS = Object.freeze([
  ...CREATE_OPERATION_FIELDS,
  'acceptedReview',
] as const);
const ACCEPTED_REVIEW_FIELDS = Object.freeze([
  'acceptPriceChange',
  'acceptGuaranteeChange',
] as const);
const CREATE_BUILDER_FIELDS = Object.freeze([
  'requestMaterial',
  'paymentAuthority',
  'paymentCard',
  'validThroughDateLocal',
  'now',
] as const);
const CREATE_BUILDER_MATERIALIZATION_FAILURE = 'Travelport reservation create builder input could not be materialized safely.';
const CREATE_OPERATION_MATERIALIZATION_FAILURE = 'Travelport reservation create operation authority could not be materialized safely.';
const REVIEWED_CREATE_OPERATION_MATERIALIZATION_FAILURE = 'Travelport reviewed reservation create operation authority could not be materialized safely.';
const ACCEPTED_REVIEW_MATERIALIZATION_FAILURE = 'Travelport reviewed reservation acceptance authority could not be materialized safely.';

export type TravelportStaysSensitiveReservationPaymentCard = Readonly<{
  cardType: 'Credit';
  cardCode: string;
  cardHolderName: string;
  expireDate: string;
  cardNumber: string;
  securityCode: string;
  billingAddress?: Readonly<{
    addressLine: string;
    city: string;
    stateProvince?: string;
    countryCode: string;
    postalCode: string;
  }>;
  telephone?: Readonly<{
    countryAccessCode: string;
    areaCityCode: string;
    phoneNumber: string;
    cityCode?: string;
  }>;
}>;

export type TravelportStaysReservationAcceptedReview = Readonly<{
  acceptPriceChange: boolean;
  acceptGuaranteeChange: boolean;
}>;

export type TravelportStaysReservationCreateRequest = Readonly<{
  ReservationQueryBuild: Readonly<{
    '@type': 'ReservationQueryBuild';
    ReservationBuild: Readonly<{
      '@type': 'ReservationBuildFromCatalogOffering';
      BuildFromCatalogOfferingHospitality: TravelportStaysReservationCreateRequestMaterial['BuildFromCatalogOfferingHospitality'];
      Traveler: TravelportStaysReservationCreateRequestMaterial['Traveler'];
      FormOfPayment: readonly [Readonly<{
        '@type': 'FormOfPaymentPaymentCard';
        PaymentCard: Readonly<{
          '@type': 'PaymentCardDetail';
          expireDate: string;
          CardType: TravelportStaysSensitiveReservationPaymentCard['cardType'];
          CardCode: string;
          CardHolderName: string;
          CardNumber: Readonly<{
            '@type': 'CardNumber';
            PlainText: string;
          }>;
          SeriesCode: Readonly<{
            '@type': 'SeriesCode';
            PlainText: string;
          }>;
          Address?: Readonly<{
            '@type': 'AddressDetail';
            AddressLine: readonly [string];
            City: string;
            StateProv?: Readonly<{ value: string }>;
            Country: Readonly<{ value: string }>;
            PostalCode: string;
          }>;
          Telephone?: readonly [Readonly<{
            '@type': 'TelephoneDetail';
            countryAccessCode: string;
            areaCityCode: string;
            phoneNumber: string;
            cityCode?: string;
          }>];
        }>;
      }>];
      Payment: TravelportStaysReservationCreateRequestMaterial['Payment'];
    }>;
  }>;
}>;

type TravelportStaysReservationCreateExecutionInput = Readonly<{
  requestCorrelationId: string;
  requestMaterial: TravelportStaysReservationCreateRequestMaterial;
  paymentAuthority: HospitalitySupplierReservationPaymentAuthority;
  acquirePaymentCard: () => Promise<TravelportStaysSensitiveReservationPaymentCard>;
  expectedReservation: TravelportStaysCreateExpectedReservation;
  beforeProviderRequest: () => Promise<void>;
}>;

type TravelportStaysReservationReviewedCreateExecutionInput = TravelportStaysReservationCreateExecutionInput & Readonly<{
  acceptedReview: TravelportStaysReservationAcceptedReview;
}>;

function invalidRequest(message = 'Travelport reservation create request is invalid.'): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function normalizeTimeout(value: number | undefined) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    invalidRequest('Travelport reservation create timeout is invalid.');
  }
  return timeoutMs;
}

function boundedSingleLine(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') invalidRequest(`${label} is required.`);
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > max
    || !normalized.isWellFormed()
    || ASCII_CONTROL_PATTERN.test(normalized)
  ) {
    invalidRequest(`${label} is invalid.`);
  }
  return normalized;
}

function optionalBoundedSingleLine(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return boundedSingleLine(value, label, max);
}

function validLocalDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Snapshot the exact Travelport accepted-card set by bounded indexed reads.
 * Never invoke an untrusted array iterator, .some(), .includes(), or a custom
 * getter twice while deciding which ephemeral card may be submitted.
 */
function snapshotAcceptedPaymentCardCodes(value: unknown): readonly string[] {
  try {
    if (!Array.isArray(value)) invalidRequest('Travelport reservation accepted-card authority is invalid.');
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_PAYMENT_CARD_CODES) {
      invalidRequest('Travelport reservation accepted-card authority is invalid.');
    }
    const codes: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(value, index)) invalidRequest('Travelport reservation accepted-card authority is invalid.');
      const code = value[index];
      if (typeof code !== 'string' || !/^[A-Z0-9]{2}$/.test(code) || seen.has(code)) {
        invalidRequest('Travelport reservation accepted-card authority is invalid.');
      }
      codes.push(code);
      seen.add(code);
    }
    return Object.freeze(codes);
  } catch {
    // Do not leak caller-controlled getter/proxy errors from the pre-provider gate.
    invalidRequest('Travelport reservation accepted-card authority is invalid.');
  }
}

function assertPaymentAuthorityMatchesRequestMaterial(
  requestMaterial: TravelportStaysReservationCreateRequestMaterial,
  authority: HospitalitySupplierReservationPaymentAuthority,
): Readonly<{
  acceptedPaymentCardCodes: readonly string[];
  payment: TravelportStaysReservationCreateRequestMaterial['Payment'];
}> {
  if (!requestMaterial || typeof requestMaterial !== 'object' || Array.isArray(requestMaterial)) {
    invalidRequest('Travelport reservation request material is required.');
  }
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    invalidRequest('Travelport reservation payment authority is required.');
  }

  let currency: unknown;
  let amountMinor: unknown;
  let kind: unknown;
  let collectionTiming: unknown;
  let cardEvidence: unknown;
  try {
    currency = authority.currency;
    amountMinor = authority.amountMinor;
    kind = authority.kind;
    collectionTiming = authority.collectionTiming;
    cardEvidence = authority.acceptedPaymentCardCodes;
  } catch {
    invalidRequest('Travelport reservation payment authority is invalid.');
  }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)
    || typeof amountMinor !== 'bigint' || amountMinor < 0n) {
    invalidRequest('Travelport reservation payment authority is invalid.');
  }
  const acceptedPaymentCardCodes = snapshotAcceptedPaymentCardCodes(cardEvidence);
  let expectedAmount: string;
  try {
    expectedAmount = moneyMinorToMajorString(amountMinor, currency);
  } catch {
    invalidRequest('Travelport reservation payment authority is invalid.');
  }
  const expectedDeposit = kind === 'PREPAY' || kind === 'DEPOSIT';
  const expectedGuarantee = kind === 'GUARANTEE';
  if (
    (!expectedDeposit && !expectedGuarantee)
    || (expectedDeposit && collectionTiming !== 'AT_BOOKING')
    || (expectedGuarantee && collectionTiming !== 'AT_PROPERTY')
  ) {
    invalidRequest('Travelport reservation payment request material no longer matches fresh supplier authority.');
  }

  try {
    const payments = requestMaterial.Payment;
    if (!Array.isArray(payments) || payments.length !== 1 || !Object.hasOwn(payments, 0)) {
      invalidRequest('Travelport reservation payment request material is invalid.');
    }
    const payment = payments[0];
    const amount = payment.Amount;
    if (
      payment['@type'] !== 'Payment'
      || amount.code !== currency
      || amount.value !== expectedAmount
      || payment.depositInd !== expectedDeposit
      || payment.guaranteeInd !== expectedGuarantee
    ) {
      invalidRequest('Travelport reservation payment request material no longer matches fresh supplier authority.');
    }
  } catch {
    // Payment objects can also carry hostile getters; never propagate their text.
    invalidRequest('Travelport reservation payment request material no longer matches fresh supplier authority.');
  }

  // Rebuild the already-validated payment instruction from local primitives.
  // The final provider payload must not re-read mutable caller-owned evidence.
  return Object.freeze({
    acceptedPaymentCardCodes,
    payment: Object.freeze([Object.freeze({
      '@type': 'Payment' as const,
      Amount: Object.freeze({ code: currency, value: expectedAmount }),
      depositInd: expectedDeposit,
      guaranteeInd: expectedGuarantee,
    })]) as TravelportStaysReservationCreateRequestMaterial['Payment'],
  });
}

function normalizeBillingAddress(value: TravelportStaysSensitiveReservationPaymentCard['billingAddress']) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidRequest('Travelport payment card billing address is invalid.');
  }
  const addressLine = boundedSingleLine(value.addressLine, 'Travelport payment card billing address line', MAX_BILLING_ADDRESS_LINE_LENGTH);
  const city = boundedSingleLine(value.city, 'Travelport payment card billing city', MAX_BILLING_CITY_LENGTH);
  const countryCode = boundedSingleLine(value.countryCode, 'Travelport payment card billing country code', 2);
  const postalCode = boundedSingleLine(value.postalCode, 'Travelport payment card billing postal code', MAX_BILLING_POSTAL_CODE_LENGTH);
  const stateProvince = optionalBoundedSingleLine(value.stateProvince, 'Travelport payment card billing state or province', MAX_BILLING_STATE_LENGTH);
  if (!/^[A-Z]{2}$/.test(countryCode)) invalidRequest('Travelport payment card billing country code is invalid.');

  return Object.freeze({
    '@type': 'AddressDetail' as const,
    AddressLine: Object.freeze([addressLine]) as readonly [string],
    City: city,
    ...(stateProvince ? { StateProv: Object.freeze({ value: stateProvince }) } : {}),
    Country: Object.freeze({ value: countryCode }),
    PostalCode: postalCode,
  });
}

function normalizePaymentTelephone(value: TravelportStaysSensitiveReservationPaymentCard['telephone']) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidRequest('Travelport payment card telephone is invalid.');
  }
  const countryAccessCode = boundedSingleLine(value.countryAccessCode, 'Travelport payment card telephone country access code', 4);
  const areaCityCode = boundedSingleLine(value.areaCityCode, 'Travelport payment card telephone area or city code', MAX_PAYMENT_PHONE_AREA_LENGTH);
  const phoneNumber = boundedSingleLine(value.phoneNumber, 'Travelport payment card telephone number', MAX_PAYMENT_PHONE_NUMBER_LENGTH);
  const cityCode = optionalBoundedSingleLine(value.cityCode, 'Travelport payment card telephone city code', MAX_PAYMENT_PHONE_CITY_CODE_LENGTH);
  if (!/^\d{1,4}$/.test(countryAccessCode) || !/^[A-Za-z0-9 .-]+$/.test(areaCityCode) || !/^[A-Za-z0-9 .-]+$/.test(phoneNumber)) {
    invalidRequest('Travelport payment card telephone is invalid.');
  }
  if (cityCode && !/^[A-Za-z0-9]{1,8}$/.test(cityCode)) invalidRequest('Travelport payment card telephone city code is invalid.');

  return Object.freeze({
    '@type': 'TelephoneDetail' as const,
    countryAccessCode,
    areaCityCode,
    phoneNumber,
    ...(cityCode ? { cityCode } : {}),
  });
}

function normalizePaymentCard(
  input: TravelportStaysSensitiveReservationPaymentCard,
  acceptedPaymentCardCodes: readonly string[],
  validThroughDateLocal: string | undefined,
  now: Date,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidRequest('Travelport payment card is required.');
  if (validThroughDateLocal !== undefined && !validLocalDate(validThroughDateLocal)) {
    invalidRequest('Travelport reservation card-valid-through date is invalid.');
  }

  const cardCode = boundedSingleLine(input.cardCode, 'Travelport payment card code', MAX_CARD_CODE_LENGTH);
  if (!/^[A-Z0-9]{2}$/.test(cardCode)) invalidRequest('Travelport payment card code is invalid.');
  if (!acceptedPaymentCardCodes.includes(cardCode)) {
    invalidRequest('Travelport payment card is not accepted by the freshly reviewed supplier terms.');
  }
  if (input.cardType !== 'Credit') {
    invalidRequest('Travelport reservation payment currently requires a freshly accepted credit card.');
  }
  const cardHolderName = boundedSingleLine(input.cardHolderName, 'Travelport payment card holder name', MAX_CARD_HOLDER_NAME_LENGTH);
  if (!/^\d{4}$/.test(input.expireDate)) invalidRequest('Travelport payment card expiry is invalid.');
  const month = Number(input.expireDate.slice(0, 2));
  const year = 2000 + Number(input.expireDate.slice(2, 4));
  if (month < 1 || month > 12 || !Number.isFinite(now.getTime())) invalidRequest('Travelport payment card expiry is invalid.');
  const expiryBoundary = new Date(Date.UTC(year, month, 1));
  const requiredThrough = validThroughDateLocal
    ? new Date(`${validThroughDateLocal}T00:00:00.000Z`)
    : now;
  if (expiryBoundary.getTime() <= now.getTime()) invalidRequest('Travelport payment card is expired.');
  if (expiryBoundary.getTime() <= requiredThrough.getTime()) {
    invalidRequest('Travelport payment card expires before the reservation stay is complete.');
  }
  if (!/^\d{8,19}$/.test(input.cardNumber)) {
    invalidRequest('Travelport payment card number is invalid.');
  }
  if (!/^\d{3,4}$/.test(input.securityCode)) invalidRequest('Travelport payment card security code is invalid.');
  const address = normalizeBillingAddress(input.billingAddress);
  const telephone = normalizePaymentTelephone(input.telephone);

  return Object.freeze({
    '@type': 'FormOfPaymentPaymentCard' as const,
    PaymentCard: Object.freeze({
      '@type': 'PaymentCardDetail' as const,
      expireDate: input.expireDate,
      CardType: input.cardType,
      CardCode: cardCode,
      CardHolderName: cardHolderName,
      CardNumber: Object.freeze({ '@type': 'CardNumber' as const, PlainText: input.cardNumber }),
      SeriesCode: Object.freeze({ '@type': 'SeriesCode' as const, PlainText: input.securityCode }),
      ...(address ? { Address: address } : {}),
      ...(telephone ? { Telephone: Object.freeze([telephone]) as readonly [typeof telephone] } : {}),
    }),
  });
}

function reviewedReservationBuildUrl(
  environment: TravelportStaysCredentials['environment'],
  acceptedReview: TravelportStaysReservationAcceptedReview | null,
) {
  const base = `${ENDPOINTS[environment]}book/reservations/build`;
  if (!acceptedReview) return base;
  if (
    typeof acceptedReview.acceptPriceChange !== 'boolean'
    || typeof acceptedReview.acceptGuaranteeChange !== 'boolean'
    || (!acceptedReview.acceptPriceChange && !acceptedReview.acceptGuaranteeChange)
  ) {
    invalidRequest('Travelport reviewed reservation acceptance flags are invalid.');
  }
  const query = new URLSearchParams();
  if (acceptedReview.acceptPriceChange) query.set('acceptPriceChangeInd', 'true');
  if (acceptedReview.acceptGuaranteeChange) query.set('acceptGuaranteeChangeInd', 'true');
  return `${base}?${query.toString()}`;
}

export function buildTravelportStaysReservationCreateRequest(input: Readonly<{
  requestMaterial: TravelportStaysReservationCreateRequestMaterial;
  paymentAuthority: HospitalitySupplierReservationPaymentAuthority;
  paymentCard: TravelportStaysSensitiveReservationPaymentCard;
  validThroughDateLocal?: string;
  now?: Date;
}>): TravelportStaysReservationCreateRequest {
  const builderInput = materializeTravelportStaysReservationOperationInput(
    input,
    CREATE_BUILDER_FIELDS,
    CREATE_BUILDER_MATERIALIZATION_FAILURE,
  );
  const stableRequestMaterial = snapshotTravelportStaysReservationCreateRequestMaterial(builderInput.requestMaterial);
  const stablePaymentAuthority = snapshotTravelportStaysReservationPaymentAuthority(builderInput.paymentAuthority);
  const validatedPayment = assertPaymentAuthorityMatchesRequestMaterial(stableRequestMaterial, stablePaymentAuthority);
  // Snapshot direct-builder card material before any validation or serialization.
  const paymentCard = snapshotTravelportStaysReservationPaymentCard(builderInput.paymentCard);
  let nowMs: number;
  try {
    const now = builderInput.now ?? new Date();
    if (!(now instanceof Date)) invalidRequest('Travelport reservation create clock is invalid.');
    nowMs = now.getTime();
  } catch {
    invalidRequest('Travelport reservation create clock is invalid.');
  }
  if (!Number.isFinite(nowMs)) invalidRequest('Travelport reservation create clock is invalid.');
  const formOfPayment = normalizePaymentCard(
    paymentCard,
    validatedPayment.acceptedPaymentCardCodes,
    builderInput.validThroughDateLocal,
    new Date(nowMs),
  );
  return Object.freeze({
    ReservationQueryBuild: Object.freeze({
      '@type': 'ReservationQueryBuild' as const,
      ReservationBuild: Object.freeze({
        '@type': 'ReservationBuildFromCatalogOffering' as const,
        BuildFromCatalogOfferingHospitality: stableRequestMaterial.BuildFromCatalogOfferingHospitality,
        Traveler: stableRequestMaterial.Traveler,
        FormOfPayment: Object.freeze([formOfPayment]) as TravelportStaysReservationCreateRequest['ReservationQueryBuild']['ReservationBuild']['FormOfPayment'],
        Payment: validatedPayment.payment,
      }),
    }),
  });
}

function ambiguousTransportFailure(): TravelportStaysReservationCreateOutcome {
  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: null,
  });
}

export class TravelportStaysReservationCreateExecutor {
  readonly #credentials: TravelportStaysCredentials;
  readonly #cacheKey: string;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(input: Readonly<{
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>) {
    const authority = materializeTravelportStaysReservationIoConstructorAuthority(input);
    this.#cacheKey = boundedSingleLine(authority.cacheKey, 'Travelport reservation create cache key', MAX_CACHE_KEY_LENGTH);
    this.#credentials = authority.credentials;
    this.#fetchImpl = authority.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(authority.timeoutMs);
    this.#now = authority.now ?? (() => new Date());
  }

  async #accessToken() {
    const nowMs = this.#now().getTime();
    const cached = readTravelportStaysCachedToken(tokenCache, this.#cacheKey, nowMs);
    if (cached) return cached.accessToken;
    const pending = tokenRequests.get(this.#cacheKey);
    if (pending) return pending;
    const request = requestTravelportStaysAccessToken({
      credentials: this.#credentials,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      nowMs,
    }).then((token) => {
      storeTravelportStaysCachedToken(tokenCache, this.#cacheKey, token, nowMs);
      return token.accessToken;
    }).finally(() => tokenRequests.delete(this.#cacheKey));
    tokenRequests.set(this.#cacheKey, request);
    return request;
  }

  async createReservation(input: TravelportStaysReservationCreateExecutionInput): Promise<TravelportStaysReservationCreateOutcome> {
    const authority = materializeTravelportStaysReservationOperationInput(
      input,
      CREATE_OPERATION_FIELDS,
      CREATE_OPERATION_MATERIALIZATION_FAILURE,
    );
    return this.#createReservation(authority, null);
  }

  async createReservationAfterAcceptedReview(
    input: TravelportStaysReservationReviewedCreateExecutionInput,
  ): Promise<TravelportStaysReservationCreateOutcome> {
    const authority = materializeTravelportStaysReservationOperationInput(
      input,
      REVIEWED_CREATE_OPERATION_FIELDS,
      REVIEWED_CREATE_OPERATION_MATERIALIZATION_FAILURE,
    );
    const acceptedReview = materializeTravelportStaysReservationOperationInput(
      authority.acceptedReview,
      ACCEPTED_REVIEW_FIELDS,
      ACCEPTED_REVIEW_MATERIALIZATION_FAILURE,
    );
    return this.#createReservation(authority, acceptedReview);
  }

  async #createReservation(
    input: TravelportStaysReservationCreateExecutionInput,
    acceptedReview: TravelportStaysReservationAcceptedReview | null,
  ): Promise<TravelportStaysReservationCreateOutcome> {
    const {
      requestCorrelationId,
      requestMaterial,
      paymentAuthority,
      acquirePaymentCard,
      expectedReservation: callerExpectedReservation,
      beforeProviderRequest,
    } = input;

    if (!SF_TRACE_ID_PATTERN.test(requestCorrelationId)) {
      invalidRequest('Travelport reservation request correlation ID is invalid.');
    }
    if (typeof acquirePaymentCard !== 'function') {
      invalidRequest('Travelport reservation payment-card acquisition callback is required.');
    }
    if (typeof beforeProviderRequest !== 'function') {
      invalidRequest('Travelport reservation provider-request marker is required.');
    }

    const expectedReservation = materializeTravelportStaysCreateExpectedReservation(callerExpectedReservation);
    if (!expectedReservation) invalidRequest('Travelport expected reservation authority is invalid.');
    const stableRequestMaterial = snapshotTravelportStaysReservationCreateRequestMaterial(requestMaterial);
    const stablePaymentAuthority = snapshotTravelportStaysReservationPaymentAuthority(paymentAuthority);
    assertPaymentAuthorityMatchesRequestMaterial(stableRequestMaterial, stablePaymentAuthority);
    const reservationUrl = reviewedReservationBuildUrl(this.#credentials.environment, acceptedReview);
    const accessToken = await this.#accessToken();
    const requestHeaders = Object.freeze({
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
      E2ETrackingID: `sf-${requestCorrelationId}`,
      username: this.#credentials.username,
      password: this.#credentials.password,
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    });

    // Catch target/query/header/credential transport-policy defects before acquiring PAN/CVV.
    // A minimal JSON object is sufficient because provider business-schema validation remains
    // adapter-owned; the final sensitive body is preflighted separately below.
    await assertTravelportStaysTransportRequestReady({
      credentials: this.#credentials,
      requestInput: reservationUrl,
      init: {
        method: 'POST',
        cache: 'no-store',
        redirect: 'manual',
        headers: requestHeaders,
        body: '{}',
      },
    });

    // Do not acquire PAN/CVV until provider authentication and non-sensitive transport preflight
    // have succeeded. Sensitive form-of-payment material then exists only for the final request-
    // composition window immediately before the durable provider-request marker and commercial POST.
    const paymentCard = await acquirePaymentCard();
    const requestBody = buildTravelportStaysReservationCreateRequest({
      requestMaterial: stableRequestMaterial,
      paymentAuthority: stablePaymentAuthority,
      paymentCard,
      validThroughDateLocal: expectedReservation.departureDateLocal,
      now: this.#now(),
    });
    const serializedBody = JSON.stringify(requestBody);

    // Reuse the exact production transport policy for the final serialized body before marking.
    // The credentialed transport validates the same request again when the real POST executes.
    await assertTravelportStaysTransportRequestReady({
      credentials: this.#credentials,
      requestInput: reservationUrl,
      init: {
        method: 'POST',
        cache: 'no-store',
        redirect: 'manual',
        headers: requestHeaders,
        body: serializedBody,
      },
    });

    // All deterministic validation, reviewed query selection, OAuth, sensitive request composition,
    // and transport-policy validation happen before the durable provider-request marker. Once the
    // marker succeeds, every transport uncertainty must settle as ambiguous instead of allowing a blind retry.
    await beforeProviderRequest();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(reservationUrl, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
        headers: requestHeaders,
        body: serializedBody,
      });
    } catch {
      return ambiguousTransportFailure();
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
    const body = await response.json().catch(() => null);
    return classifyTravelportStaysReservationCreateOutcome({
      httpStatus: response.status,
      body,
      expectedReservation,
    });
  }
}
