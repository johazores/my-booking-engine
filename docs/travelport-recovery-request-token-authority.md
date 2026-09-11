# Travelport recovery request-token authority

## Purpose

Known-locator Travelport Stays recovery is a read-only commercial reconciliation path. It uses durable provider identity and request correlation to decide which reservation evidence SF is allowed to retrieve and interpret. Those values are request authority, not display text, so SF must not silently normalize a different textual value into a valid provider request.

This hardening does not enable the Travelport `reservation` capability. It strengthens the existing server-only recovery path while the Phase 15 activation gates remain open.

## Exact request-token boundary

`TravelportStaysReservationRecoveryProvider` now applies one exact bounded-string rule to:

- the integration-scoped recovery cache key;
- the durable provider reservation reference used in the Retrieve URL; and
- the request correlation ID used for `E2ETrackingID` and `TraceId`.

Each value must:

1. be a non-empty string;
2. already be in its canonical outer-whitespace form;
3. remain inside its existing length bound; and
4. contain no ASCII control character from `U+0000` through `U+001F` or `U+007F`.

Leading or trailing whitespace is rejected instead of trimmed into authority. Tab, NUL, unit separator, DEL, CR, LF, and the rest of the ASCII control range fail closed.

## Ordering and provider I/O

The recovery adapter validates the provider reservation reference, request correlation, and durable reservation expectation before requesting an access token or issuing Hotel Retrieve. Invalid request authority therefore cannot create an OAuth request, provider request, alternate encoded locator URL, or correlation header.

The provider locator continues to be URL-encoded only after validation. The correlation value continues to be sent unchanged in both `E2ETrackingID` and `TraceId`.

## Similar-issue sweep

Initial Create and Booking.com Sync were reviewed for the same authority defect. Their provider-owned submission, accepted-card, supplier-confirmation, response-correlation, and shared supplier-property-reference boundaries already reject outer normalization and the full ASCII control range under the existing commercial machine-token contracts.

Broader customer/contact text remains outside this machine-authority contract. This change does not recase, rewrite, or invent provider identifiers, and it does not add secrets or payment data to logs, persistence, or audit payloads.

## Validation

Focused regression coverage pins rejection of padded and control-bearing recovery cache keys, durable provider locators, and request correlation IDs before provider I/O. A dependency-free source contract pins the shared exact-token rule, validation ordering, Retrieve URL binding, correlation headers, and disabled capability boundary.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live Travelport recovery verification requires provisioned non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This hardening does not satisfy the remaining Phase 15 activation gates:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. establish authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-known-locator-machine-token-authority.md`
- `docs/travelport-reservation-property-reference-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-stays-integration.md`
