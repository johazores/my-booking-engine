# Supplier provider request observability

## Purpose

SF needs operational evidence for external supplier calls without copying provider payloads, credentials, traveler data, payment data, or reservation locators into logs. Known-locator supplier reservation recovery is the first supplier workflow with a durable outbound request identity, so it emits one privacy-safe structured completion record around the real provider request.

This is operational logging only. It does not replace the supplier reservation ledger, business audit history, provider-truth reconciliation, or idempotency rules, and it never makes an ambiguous reservation safe to retry.

## Authority and ordering

`reconcileHospitalitySupplierReservationWithProvider` first claims the tenant-owned reconciliation operation through the existing durable ledger. That claim already verifies server-side `booking:manage`, organization ownership, active integration state, credential version, and the `reservation` capability, and persists the current reconciliation attempt before any provider I/O.

The coordinator also verifies that a known provider reservation reference exists and that the injected recovery adapter code matches the durable provider code. Only after those checks does it create the provider-request observation and call `retrieveReservation`.

No provider-request completion record is emitted when the provider call never occurs, including provider-code mismatch or missing durable locator. Those cases remain represented by the durable supplier reservation state/audit boundary.

The provider-I/O `try/catch` ends before durable reconciliation settlement. Provider result fields are then normalized and checked against durable reservation identity and supplier-confirmation authority before an info-level `FOUND` or `NOT_FOUND` result can be emitted. A later database/settlement failure is still not mislabeled as a provider outage or followed by a second settlement attempt. The supplier operation ledger and audit history remain the authority for whether reconciliation was durably settled.

## Correlation contract

The structured event is `supplier.reservation-recovery.provider-request.completed`. Its `requestCorrelationId` is the persisted `HospitalitySupplierReservationAttempt.id` used for that exact outbound call. For Travelport known-locator Hotel Retrieve, the adapter maps the same attempt UUID to `TraceId` and `E2ETrackingID`, so an SF completion record can be correlated with the durable attempt and with Travelport support evidence without persisting another identifier.

The record contains only:

- timestamp and elapsed milliseconds;
- `info` or `warn` level;
- the fixed event and `reservation.retrieve` operation names;
- the durable attempt UUID as `requestCorrelationId`;
- the already-authorized organization UUID;
- the bounded provider code;
- `succeeded` or `failed` provider-request outcome;
- `FOUND` / `NOT_FOUND` only when the provider returned accepted normalized, identity-consistent evidence;
- a normalized `HospitalitySupplierFailureCode` only when the provider request failed or returned invalid evidence.

UUID and provider-code fields are validated again by the logging boundary and fail closed to fixed non-sensitive placeholders rather than accepting arbitrary text. The observer emits at most one completion record even if a caller accidentally attempts to finish it twice.

## Privacy boundary

The event never includes the provider reservation locator, supplier confirmation, provider response correlation ID, integration ID, credential version, property/rate identifiers, offer or request fingerprints, idempotency keys, request URL, request/response body, headers, OAuth token, username/password/client credentials, traveler/customer data, card/payment/guarantee material, or raw caught error/message.

Travelport response `traceId` evidence may still be normalized into the durable ledger under the existing bounded correlation field. It is deliberately not copied into this operational log; the already-persisted outbound attempt UUID is the support correlation key for this event.

## Provider result safety

Structured provider observations treat their result enums as runtime trust boundaries rather than relying only on TypeScript unions. Recovery logging accepts only `FOUND` or `NOT_FOUND` for a successful provider result. A malformed successful result becomes a warning-level `failed / INVALID_RESPONSE` record, and the untrusted value is never copied into the log.

The reconciliation coordinator normalizes provider-correlation and recovered supplier-confirmation fields before durable settlement. A malformed field becomes `UNKNOWN / INVALID_RESPONSE`. Supplier-confirmation completeness and identity are then evaluated through the shared provider-neutral evidence rule before either success observation is allowed.

For `FOUND`, a known durable supplier confirmation must be returned exactly, and an operation whose prior ambiguity is specifically `SUPPLIER_CONFIRMATION_MISSING` must recover a supplier confirmation before the provider result can be logged as successful. Missing or conflicting evidence produces a warning-level `failed / INVALID_RESPONSE` observation while the durable ledger records the more specific non-secret `SUPPLIER_CONFIRMATION_MISSING` or `SUPPLIER_CONFIRMATION_MISMATCH` state and preserves known reservation identity.

For provider-neutral `NOT_FOUND`, a durable supplier confirmation is contradictory lifecycle evidence. SF does not emit an info-level `NOT_FOUND`, erase the known supplier/provider identity, or authorize another Create in that case. The observation is warning-level `failed / INVALID_RESPONSE`, and the durable operation remains ambiguous with `SUPPLIER_CONFIRMATION_MISMATCH`. Only authoritative negative evidence for an operation with no durable supplier confirmation can reach the normal `NOT_FOUND` settlement path. Travelport itself still does not infer authoritative `NOT_FOUND` from a generic HTTP 404.

Travelport Create logging accepts only `CONFIRMED`, `FAILED`, `REVIEW_REQUIRED`, or `AMBIGUOUS`; Travelport Sync logging accepts only `CONFIRMED` or `AMBIGUOUS`. Any other runtime value fails closed to a warning-level `ambiguous` observation without copying the value. This keeps malformed adapter/runtime data from becoming an info-level success-looking record or an accidental logging channel.

The reconciliation coordinator separately accepts only the two provider-neutral result statuses declared by the recovery contract: `FOUND` and `NOT_FOUND`. A runtime adapter value outside that union fails closed as `INVALID_RESPONSE`, is logged as a failed provider request, and settles the durable operation back to `AMBIGUOUS` through the existing `UNKNOWN` path. It is never treated as `NOT_FOUND` by fallthrough.

Exact-locator identity checks remain unchanged. A mismatched returned locator is also `INVALID_RESPONSE`.

## Validation

`scripts/supplier-reservation-provider-observability.test.mjs` covers the safe structured recovery record, normalization of unsafe log identifiers, malformed success-result fail-closed behavior, one-completion-only behavior, authority/provider-I/O ordering, durable attempt correlation, explicit `FOUND` / `NOT_FOUND` handling, fail-closed unrecognized provider results, and the requirement that supplier-confirmation evidence be accepted before either success observation. `scripts/supplier-reservation-recovery-supplier-identity-contract.test.mjs` separately pins evidence normalization, durable settlement defense in depth, and the rule that a known supplier confirmation cannot be replaced or erased by recovery.

Full repository validation still requires the repository Node 24 toolchain. Database-backed supplier scenarios still require an explicitly disposable PostgreSQL target, and live Travelport verification still requires provisioned non-production credentials. GitHub Actions are not used for validation.
