# Authenticated hospitality JSON ingress

## Status

SF now applies a shared bounded JSON-object reader across every current authenticated hospitality route that accepts a JSON request body, including core booking, guest management, commercial modification, legal-document issuance, and commercial-amendment settlement boundaries.

The shared boundary lives in `src/server/bookings/hospitality-booking-http.ts` and preserves the existing authenticated active-tenant and same-origin write authority. It accepts only `application/json`, requires valid UTF-8, validates an advertised `Content-Length` when present, rejects non-object JSON, and enforces a 64 KiB streamed ceiling even when no length header is supplied.

Malformed media type, length, encoding, JSON, or envelope shape fails closed as `400 invalid-request`. Authentication, active-tenant resolution, permissions, service-level validation, idempotency, tenant ownership, booking locks, pricing, availability, settlement, and legal-document rules remain owned by the existing services and are not replaced by this transport boundary.

## Current covered routes

- `POST /api/bookings/hospitality/search`
- `POST /api/bookings/hospitality/availability`
- `POST /api/bookings/hospitality/quote`
- `POST /api/bookings/hospitality/holds`
- `POST /api/bookings/hospitality/confirm`
- `POST /api/bookings/hospitality/[booking-id]/reschedule`
- `POST /api/bookings/hospitality/[booking-id]/guests`
- `POST /api/bookings/hospitality/[booking-id]/modify`
- `POST /api/bookings/hospitality/[booking-id]/modify/preview`
- `POST /api/bookings/hospitality/[booking-id]/tax-invoices`
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments`
- `POST /api/bookings/hospitality/[booking-id]/adjustment-notes`
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note`
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/manual-settlement`
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-refund`

## Remaining same-pattern sweep

No authenticated hospitality JSON-body route remains on raw `request.json()`. Generic authenticated payment APIs use a separate payment transport policy rather than coupling financial routes to the hospitality parser.

## Validation

`src/server/bookings/hospitality-booking-http.test.ts` covers JSON-object enforcement, media type, advertised and streamed size bounds, strict UTF-8 decoding, and caller-specific limits. `scripts/authenticated-hospitality-core-json-ingress-contract.test.mjs` prevents the covered routes from returning to raw `request.json()`.

Full repository validation still requires the repository Node 24.20+ toolchain and the disposable PostgreSQL gates documented in the development guide. GitHub Actions are not used.

## Authenticated error classification

Authenticated booking HTTP errors use explicit domain validation classes for customer-correctable input. A generic thrown `Error` is never classified as HTTP 400 from English words in its message: unexpected infrastructure, database, or provider diagnostics return a generic HTTP 500 body with `no-store`. Known booking/payment conflicts and unavailable resources retain their existing status codes. Commercial modification and traveler-capacity input validation now use the booking-domain validation type. The authenticated commercial-amendment preparation route also maps invalid client-supplied adjustment fingerprints to typed HTTP 400 validation without changing internal hold/time invariant error handling. The hospitality commercial-amendment settlement, refund, and recovery routes also recognize explicit payment input validation (including idempotency keys and manual references) as HTTP 400 instead of incorrectly reporting a server failure. Persisted invalid occupancy configuration remains an internal failure rather than being presented as customer input.

The authenticated hospitality JSON reader now delegates to the shared transport-only `src/server/http/bounded-json-body.ts` module. It rejects declared `Content-Length` values that do not exactly match the streamed body, in addition to the existing byte ceiling, UTF-8, and object-shape checks. Its typed 400 response and authenticated tenant/permission boundaries remain unchanged.
