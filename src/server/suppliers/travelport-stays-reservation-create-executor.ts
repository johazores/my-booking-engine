import { moneyMinorToMajorString } from '../pricing/money.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import type { TravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';
import {
  classifyTravelportStaysReservationCreateOutcome,
  type TravelportStaysCreateExpectedReservation,
  type TravelportStaysReservationCreateOutcome,
} from './travelport-stays-reservation-create-outcome.ts';
import {
  requestTravelportStaysAccessToken,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': 'https://api.pp.travelport.net/11/hotel/',
  production: 'https://api.travelport.net/11/hotel/',
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CACHE_KEY_LENGTH = 512;
const MAX_CARD_HOLDER_NAME_LENGTH = 160;
const MAX_CARD_CODE_LENGTH = 16;
const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();

export type TravelportStaysSensitiveReservationPaymentCard = Readonly<{
  cardType: 'Credit';
  cardCode: string;
  cardHolderName: string;
  expireDate: string;
  cardNumber: string;
  securityCode: string;
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
        }>;
      }>];
      Payment: TravelportStaysReservationCreateRequestMaterial['Payment'];
    }>;
  }>;
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
  if (!normalized || normalized !== value || normalized.length > max || /[\r\n]/.test(normalized)) {
    invalidRequest(`${label} is invalid.`);
  }
  return normalized;
}

function validLocalDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertExpectedReservation(expected: TravelportStaysCreateExpectedReservation) {
  if (
    !expected
    || typeof expected !== 'object'
    || Array.isArray(expected)
    || typeof expected.chainCode !== 'string'
    || !/^[A-Za-z0-9]{1,16}$/.test(expected.chainCode)
    || typeof expected.propertyCode !== 'string'
    || !/^[A-Za-z0-9]{1,32}$/.test(expected.propertyCode)
    || !validLocalDate(expected.arrivalDateLocal)
    || !validLocalDate(expected.departureDateLocal)
    || expected.departureDateLocal <= expected.arrivalDateLocal
    || expected.rooms !== 1
    || !Number.isInteger(expected.guests)
    || expected.guests < 1
    || expected.guests > 9
  ) {
    invalidRequest('Travelport expected reservation authority is invalid.');
  }
}

function assertPaymentAuthorityMatchesRequestMaterial(
  requestMaterial: TravelportStaysReservationCreateRequestMaterial,
  authority: HospitalitySupplierReservationPaymentAuthority,
) {
  if (!requestMaterial || typeof requestMaterial !== 'object' || Array.isArray(requestMaterial)) {
    invalidRequest('Travelport reservation request material is required.');
  }
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    invalidRequest('Travelport reservation payment authority is required.');
  }
  if (!/^[A-Z]{3}$/.test(authority.currency) || typeof authority.amountMinor !== 'bigint' || authority.amountMinor < 0n) {
    invalidRequest('Travelport reservation payment authority is invalid.');
  }
  if (!Array.isArray(requestMaterial.Payment) || requestMaterial.Payment.length !== 1) {
    invalidRequest('Travelport reservation payment request material is invalid.');
  }

  const payment = requestMaterial.Payment[0];
  let expectedAmount: string;
  try {
    expectedAmount = moneyMinorToMajorString(authority.amountMinor, authority.currency);
  } catch {
    invalidRequest('Travelport reservation payment authority is invalid.');
  }
  const expectedDeposit = authority.kind === 'PREPAY' || authority.kind === 'DEPOSIT';
  const expectedGuarantee = authority.kind === 'GUARANTEE';
  if (
    (!expectedDeposit && !expectedGuarantee)
    || (expectedDeposit && authority.collectionTiming !== 'AT_BOOKING')
    || (expectedGuarantee && authority.collectionTiming !== 'AT_PROPERTY')
    || payment['@type'] !== 'Payment'
    || payment.Amount.code !== authority.currency
    || payment.Amount.value !== expectedAmount
    || payment.depositInd !== expectedDeposit
    || payment.guaranteeInd !== expectedGuarantee
  ) {
    invalidRequest('Travelport reservation payment request material no longer matches fresh supplier authority.');
  }
}

function normalizePaymentCard(
  input: TravelportStaysSensitiveReservationPaymentCard,
  authority: HospitalitySupplierReservationPaymentAuthority,
  now: Date,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidRequest('Travelport payment card is required.');
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) invalidRequest('Travelport payment authority is required.');

  const cardCode = boundedSingleLine(input.cardCode, 'Travelport payment card code', MAX_CARD_CODE_LENGTH);
  if (!Array.isArray(authority.acceptedPaymentCardCodes) || !authority.acceptedPaymentCardCodes.includes(cardCode)) {
    invalidRequest('Travelport payment card is not accepted by the freshly reviewed supplier terms.');
  }
  // Fresh Rules authority is derived from AcceptedCreditCard, so the current write path
  // cannot authorize debit or gift card semantics even though Travelport's generic payload
  // type lists those values. Expand only when fresh supplier authority can prove that type.
  if (input.cardType !== 'Credit') {
    invalidRequest('Travelport reservation payment currently requires a freshly accepted credit card.');
  }
  const cardHolderName = boundedSingleLine(input.cardHolderName, 'Travelport payment card holder name', MAX_CARD_HOLDER_NAME_LENGTH);
  if (!/^\d{4}$/.test(input.expireDate)) invalidRequest('Travelport payment card expiry is invalid.');
  const month = Number(input.expireDate.slice(0, 2));
  const year = 2000 + Number(input.expireDate.slice(2, 4));
  if (month < 1 || month > 12 || !Number.isFinite(now.getTime())) invalidRequest('Travelport payment card expiry is invalid.');
  const expiryBoundary = new Date(Date.UTC(year, month, 1));
  if (expiryBoundary.getTime() <= now.getTime()) invalidRequest('Travelport payment card is expired.');
  if (!/^\d{8,19}$/.test(input.cardNumber)) invalidRequest('Travelport payment card number is invalid.');
  if (!/^\d{3,4}$/.test(input.securityCode)) invalidRequest('Travelport payment card security code is invalid.');

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
    }),
  });
}

export function buildTravelportStaysReservationCreateRequest(input: Readonly<{
  requestMaterial: TravelportStaysReservationCreateRequestMaterial;
  paymentAuthority: HospitalitySupplierReservationPaymentAuthority;
  paymentCard: TravelportStaysSensitiveReservationPaymentCard;
  now?: Date;
}>): TravelportStaysReservationCreateRequest {
  assertPaymentAuthorityMatchesRequestMaterial(input.requestMaterial, input.paymentAuthority);
  const formOfPayment = normalizePaymentCard(input.paymentCard, input.paymentAuthority, input.now ?? new Date());
  return Object.freeze({
    ReservationQueryBuild: Object.freeze({
      '@type': 'ReservationQueryBuild' as const,
      ReservationBuild: Object.freeze({
        '@type': 'ReservationBuildFromCatalogOffering' as const,
        BuildFromCatalogOfferingHospitality: input.requestMaterial.BuildFromCatalogOfferingHospitality,
        Traveler: input.requestMaterial.Traveler,
        FormOfPayment: Object.freeze([formOfPayment]) as TravelportStaysReservationCreateRequest['ReservationQueryBuild']['ReservationBuild']['FormOfPayment'],
        Payment: input.requestMaterial.Payment,
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
    this.#cacheKey = boundedSingleLine(input.cacheKey, 'Travelport reservation create cache key', MAX_CACHE_KEY_LENGTH);
    this.#credentials = input.credentials;
    this.#fetchImpl = input.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(input.timeoutMs);
    this.#now = input.now ?? (() => new Date());
  }

  async #accessToken() {
    const nowMs = this.#now().getTime();
    const cached = tokenCache.get(this.#cacheKey);
    if (cached && cached.expiresAtMs > nowMs) return cached.accessToken;
    const pending = tokenRequests.get(this.#cacheKey);
    if (pending) return pending;
    const request = requestTravelportStaysAccessToken({
      credentials: this.#credentials,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      nowMs,
    }).then((token) => {
      tokenCache.set(this.#cacheKey, token);
      return token.accessToken;
    }).finally(() => tokenRequests.delete(this.#cacheKey));
    tokenRequests.set(this.#cacheKey, request);
    return request;
  }

  async createReservation(input: Readonly<{
    requestCorrelationId: string;
    requestMaterial: TravelportStaysReservationCreateRequestMaterial;
    paymentAuthority: HospitalitySupplierReservationPaymentAuthority;
    paymentCard: TravelportStaysSensitiveReservationPaymentCard;
    expectedReservation: TravelportStaysCreateExpectedReservation;
    beforeProviderRequest: () => Promise<void>;
  }>): Promise<TravelportStaysReservationCreateOutcome> {
    if (!SF_TRACE_ID_PATTERN.test(input.requestCorrelationId)) {
      invalidRequest('Travelport reservation request correlation ID is invalid.');
    }
    if (typeof input.beforeProviderRequest !== 'function') {
      invalidRequest('Travelport reservation provider-request marker is required.');
    }

    assertExpectedReservation(input.expectedReservation);
    const requestBody = buildTravelportStaysReservationCreateRequest({
      requestMaterial: input.requestMaterial,
      paymentAuthority: input.paymentAuthority,
      paymentCard: input.paymentCard,
      now: this.#now(),
    });
    const accessToken = await this.#accessToken();
    const serializedBody = JSON.stringify(requestBody);

    // All validation, sensitive request composition, and OAuth happen before the durable
    // provider-request marker. Once the marker succeeds, every transport uncertainty must
    // settle as ambiguous instead of allowing a blind create retry.
    await input.beforeProviderRequest();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(`${ENDPOINTS[this.#credentials.environment]}book/reservations/build`, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
          E2ETrackingID: `sf-${input.requestCorrelationId}`,
          username: this.#credentials.username,
          password: this.#credentials.password,
          client_id: this.#credentials.clientId,
          client_secret: this.#credentials.clientSecret,
        },
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
      expectedReservation: input.expectedReservation,
    });
  }
}
