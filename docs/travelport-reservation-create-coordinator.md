# Travelport Reservation Create Coordinator

## Purpose

SF now has a server-only orchestration boundary that connects the already implemented fresh reservation authority review, durable supplier reservation attempt ledger, Travelport v11 Create Reservation executor, conservative response classifier, and durable settlement path. The coordinator is production infrastructure only: Travelport `reservation` remains disabled in the configured capability list and no browser route, staff action, customer action, or public API can invoke it.

The coordinator is also **not a card-collection surface**. Its sensitive payment-card argument exists only so a future reviewed PCI-safe server boundary can hand ephemeral form-of-payment material directly to the provider adapter. This work does not authorize PAN/CVV, billing address, or payment-card telephone collection through ordinary SF forms, APIs, persistence, logs, queues, analytics, or audit payloads.

## Execution sequence

`createTravelportStaysReservationWithSensitivePaymentCard` uses the existing authoritative submission gate first. That gate performs server-side `availability:read`, `pricing:read`, and `booking:manage` authorization, tenant-scoped operation lookup, traveler fingerprint re-binding, current Rules/Availability review, exact request-fingerprint-v2 re-binding, current sell-reference validation, fresh non-secret payment authority derivation, and the durable create claim.

After the claim, the coordinator reloads the active Travelport integration and requires the exact integration ID, provider code, credential version, and `reservation` capability that are bound to the durable operation. This second check closes the rotation window between the fresh review/claim and execution. If configuration changes before the commercial write boundary, the attempt settles as a non-retryable pre-provider authority failure rather than sending with different supplier credentials.

The expected provider receipt identity is rebuilt from durable operation evidence only: the opaque Travelport property identity, stay dates, one-room occupancy, and guest count. Property-reference decoding is shared with known-locator recovery so Create and Retrieve cannot drift into different identity rules.

The Travelport executor performs sensitive request validation/composition and OAuth before any commercial provider-write marker. Payment-card validation includes the freshly accepted Travelport card code, provider-compatible two-character maximum, cardholder/PAN/security-code shape, expiry through the durable stay, and bounded optional billing-address/payment-telephone material when supplied. Immediately before the Create Reservation POST can begin, its callback records `providerRequestStartedAt` on the exact current tenant-scoped attempt. The durable attempt UUID is also the request correlation ID used by Travelport tracing and safe structured provider observation.

## Failure and review semantics

Failures before the durable provider-request marker are safe from duplicate reservation creation because the protected commercial write was not authorized to start. That fact alone does not make every failure retryable. The coordinator uses the provider-neutral pre-provider retry classifier: only `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT` authorize an automatic retry. Authentication failures, invalid request/response authority, integration drift, and unexpected application/configuration failures settle as non-retryable. A later permitted submission still repeats the complete fresh authority gate; retryability never makes earlier Availability or Rules evidence timeless.

If an executor ever returns a commercial outcome without invoking the protected callback, the coordinator treats that as a contract violation: it records conservative provider-request evidence and settles `AMBIGUOUS / INVALID_RESPONSE` so crash recovery can never reopen the write as a blind retry.

Once the marker completes, uncertainty is never downgraded to a retryable create failure. Confirmed receipts become `CONFIRMED`; reviewed newer-format `category=VALIDATION` no-sell errors become bounded `TRAVELPORT_VALIDATION_<SourceCode>` failures; and unknown, mixed, malformed, older-format, `UNKNOWN`, or `RETRY` error evidence never becomes a definitive no-sell result.

Documented price/guarantee changes are different from ordinary failure. They are stored as a dedicated provider-neutral `REVIEW_REQUIRED` operation and attempt state with one of the fixed reasons `SUPPLIER_PRICE_CHANGED`, `SUPPLIER_GUARANTEE_CHANGED`, or `SUPPLIER_PRICE_AND_GUARANTEE_CHANGED`. This transition requires the exact current tenant-scoped `CREATE` attempt and its durable provider-request marker. It has no generic retry authority, and normal create submission explicitly rejects the state. The initial Create request still never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`.

An authorized actor can now record the exact pending review decision through the server-only Travelport review-acceptance service. That service requires `availability:read`, `pricing:read`, and `booking:manage`, rebinds the immutable traveler fingerprint, checks the same integration/credential version and disabled `reservation` capability boundary, revalidates the current selected offer, retrieves current Rules, repeats selected-offer Availability authority, derives current payment/guarantee authority, and persists actor/time, accepted dimensions, exact total, and current offer/terms/authority fingerprints under a database all-or-none contract. The operation intentionally stays `REVIEW_REQUIRED`; this decision cannot enter normal retry and cannot invoke the current Create executor.

Automatic retry after a definitive provider no-sell response is limited to reviewed failures that can be corrected entirely inside the ephemeral form-of-payment input without changing durable reservation/traveler authority. The current allowlist covers card code/expiry/cardholder/number/CVV/type (`1537`-`1542`), billing address (`1543`-`1547` and `13050`), form-of-payment telephone (`13054`, `13083`), and supplier card-type rejection (`13078`). Every permitted retry repeats the full fresh authority gate. Traveler validation failures remain non-retryable on the existing operation because traveler identity/contact is bound into the durable reservation payload fingerprint.

If durable settlement itself fails after provider execution, the operation remains in-flight and the existing execution lease recovery sees the provider-request marker. It therefore fails closed to ambiguity rather than reopening the create. This preserves the crash-safety contract without treating logging or application exceptions as supplier truth.

## Privacy and observability

The create provider observation is a strict allowlist containing only timestamp, level, SF attempt correlation UUID, organization UUID, fixed provider/operation names, normalized outcome, and duration. It never includes traveler data, provider locators, supplier confirmations, offer references, request/response bodies, access tokens, credentials, card code, cardholder, PAN, CVV/security code, expiry, billing address, payment-card telephone, or other billing data.

Sensitive payment-card material is passed only from the coordinator argument into the server-only Travelport executor. It is not added to the supplier operation/attempt rows, audit metadata, provider observation, request fingerprint, or application logs.

The review-acceptance audit event is separately allowlisted to provider code, normalized review reason, accepted dimensions, accepted currency/total, review attempt sequence, and the acceptance fingerprint. It does not persist traveler PII, raw provider payloads, the expiring provider submission reference, credentials, PAN, CVV, cardholder, or other form-of-payment material.

## Remaining activation boundary

This coordinator removes the missing initial orchestration dependency, and the authorized review-decision persistence boundary is now implemented, but Travelport `reservation` remains disabled. Production activation still requires a reviewed PCI-safe form-of-payment source/handling strategy for the provisioned Travelport account, live non-production SearchComplete → Rules → Availability → Create → Sync validation, a dedicated one-time acceptance claim/consumption path that revalidates the recorded decision and sends only the applicable Travelport second-request query parameter(s), live validation of that price/guarantee second-sell behavior, and authoritative locator-less/`13034` correlation semantics. Only after those gates are verified should SF advertise the reservation capability or expose reserve UX.

See also:

- `docs/supplier-reservation-submission-authority.md`
- `docs/supplier-reservation-create-readiness.md`
- `docs/supplier-reservation-attempt-recovery.md`
- `docs/supplier-reservation-review-acceptance.md`
- `docs/travelport-stays-integration.md`
