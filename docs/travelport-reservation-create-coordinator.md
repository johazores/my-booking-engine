# Travelport Reservation Create Coordinator

## Purpose

SF now has a server-only orchestration boundary that connects the already implemented fresh reservation authority review, durable supplier reservation attempt ledger, Travelport v11 Create Reservation executor, conservative response classifier, and durable settlement path. The coordinator is production infrastructure only: Travelport `reservation` remains disabled in the configured capability list and no browser route, staff action, customer action, or public API can invoke it.

The coordinator is also **not a card-collection surface**. Its sensitive payment-card argument exists only so a future reviewed PCI-safe server boundary can hand ephemeral form-of-payment material directly to the provider adapter. This work does not authorize PAN/CVV, billing address, or payment-card telephone collection through ordinary SF forms, APIs, persistence, logs, queues, analytics, or audit payloads.

## Execution sequence

`createTravelportStaysReservationWithSensitivePaymentCard` uses the existing authoritative submission gate first. That gate performs server-side `availability:read`, `pricing:read`, and `booking:manage` authorization, tenant-scoped operation lookup, traveler fingerprint re-binding, current Rules/Availability review, exact request-fingerprint-v2 re-binding, current sell-reference validation, fresh non-secret payment authority derivation, and the durable create claim.

After the claim, the coordinator reloads the active Travelport integration and requires the exact integration ID, provider code, credential version, and `reservation` capability that are bound to the durable operation. This second check closes the rotation window between the fresh review/claim and execution. If configuration changes before the commercial write boundary, the attempt settles as a non-retryable pre-provider authority failure rather than sending with different supplier credentials.

The expected provider receipt identity is rebuilt from durable operation evidence only: the opaque Travelport property identity, stay dates, one-room occupancy, and guest count. Property-reference decoding is shared with known-locator recovery so Create and Retrieve cannot drift into different identity rules.

The Travelport executor performs sensitive request validation/composition and OAuth before any commercial provider-write marker. Payment-card validation includes the freshly accepted Travelport card code, provider-compatible two-character maximum, cardholder/PAN/security-code shape, expiry through the durable stay, and bounded optional billing-address/payment-telephone material when supplied. Immediately before the Create Reservation POST can begin, its callback records `providerRequestStartedAt` on the exact current tenant-scoped attempt. The durable attempt UUID is also the request correlation ID used by Travelport tracing and safe structured provider observation.

## Failure semantics

Failures before the durable provider-request marker are safe from duplicate reservation creation because the protected commercial write was not authorized to start. That fact alone does not make every failure retryable. The coordinator uses the provider-neutral pre-provider retry classifier: only `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT` authorize an automatic retry. Authentication failures, invalid request/response authority, integration drift, and unexpected application/configuration failures settle as non-retryable. A later permitted submission still repeats the complete fresh authority gate; retryability never makes earlier Availability or Rules evidence timeless.

If an executor ever returns a commercial outcome without invoking the protected callback, the coordinator treats that as a contract violation: it records conservative provider-request evidence and settles `AMBIGUOUS / INVALID_RESPONSE` so crash recovery can never reopen the write as a blind retry.

Once the marker completes, uncertainty is never downgraded to a retryable create failure. Normal executor results are mapped through the Travelport outcome bridge: confirmed receipts become `CONFIRMED`; documented price/guarantee changes become non-retryable review failures; and reviewed newer-format `category=VALIDATION` no-sell errors become bounded `TRAVELPORT_VALIDATION_<SourceCode>` failures. Unknown, mixed, malformed, older-format, `UNKNOWN`, or `RETRY` error evidence never becomes a definitive no-sell result.

Only the reviewed payment-card validation codes for card code, expiry, cardholder, number, CVV, and card type (`1537`-`1542`) are currently retryable after a marked provider request. Travelport documents these as unsuccessful validation outcomes, and the sensitive card is deliberately excluded from the durable reservation fingerprint, so a corrected ephemeral card can repeat the full fresh-authority gate without treating an uncertain supplier state as retry-safe. Travelport also documents address/telephone validation failures for form of payment; SF can now compose those optional fields, but broader retry authority for those source codes remains fail-closed until that classifier contract is expanded deliberately. Other definitive validation failures are non-retryable for the existing operation.

If durable settlement itself fails after provider execution, the operation remains in-flight and the existing execution lease recovery sees the provider-request marker. It therefore fails closed to ambiguity rather than reopening the create. This preserves the crash-safety contract without treating logging or application exceptions as supplier truth.

## Privacy and observability

The create provider observation is a strict allowlist containing only timestamp, level, SF attempt correlation UUID, organization UUID, fixed provider/operation names, normalized outcome, and duration. It never includes traveler data, provider locators, supplier confirmations, offer references, request/response bodies, access tokens, credentials, card code, cardholder, PAN, CVV/security code, expiry, billing address, payment-card telephone, or other billing data.

Sensitive payment-card material is passed only from the coordinator argument into the server-only Travelport executor. It is not added to the supplier operation/attempt rows, audit metadata, provider observation, request fingerprint, or application logs.

## Remaining activation boundary

This coordinator removes the missing orchestration dependency, but Travelport `reservation` remains disabled. Production activation still requires a reviewed PCI-safe form-of-payment source/handling strategy for the provisioned Travelport account, live non-production SearchComplete → Rules → Availability → Create validation, explicit authorized price/guarantee-change acceptance behavior, and safe locator-less/Booking.com Sync recovery plus authoritative negative/correlation semantics. Only after those gates are verified should SF advertise the reservation capability or expose reserve UX.

See also:

- `docs/supplier-reservation-submission-authority.md`
- `docs/supplier-reservation-create-readiness.md`
- `docs/supplier-reservation-attempt-recovery.md`
- `docs/travelport-stays-integration.md`
