# Authenticated hospitality JSON ingress

## Status

SF now applies a shared bounded JSON-object reader to the authenticated hospitality booking request path used for search, availability, quote, hold creation, confirmation, date rescheduling, commercial modification/preview, tax-invoice issuance, and commercial-amendment preparation.

The shared boundary lives in `src/server/bookings/hospitality-booking-http.ts` and preserves the existing authenticated active-tenant and same-origin write authority. It accepts only `application/json`, requires valid UTF-8, validates an advertised `Content-Length` when present, rejects non-object JSON, and enforces a 64 KiB streamed ceiling even when no length header is supplied.

Malformed media type, length, encoding, JSON, or envelope shape fails closed as `400 invalid-request`. Authentication, active-tenant resolution, permissions, service-level validation, idempotency, tenant ownership, booking locks, pricing, availability, and commercial rules remain owned by the existing services and are not replaced by this transport boundary.

## Current covered routes

- `POST /api/bookings/hospitality/search`
- `POST /api/bookings/hospitality/availability`
- `POST /api/bookings/hospitality/quote`
- `POST /api/bookings/hospitality/holds`
- `POST /api/bookings/hospitality/confirm`
- `POST /api/bookings/hospitality/[booking-id]/reschedule`
- `POST /api/bookings/hospitality/[booking-id]/modify`
- `POST /api/bookings/hospitality/[booking-id]/modify/preview`
- `POST /api/bookings/hospitality/[booking-id]/tax-invoices`
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments`

## Remaining same-pattern sweep

Guest updates, cancellation adjustment-note issuance, commercial-amendment manual settlement, Stripe refund execution, commercial-amendment adjustment-note issuance, and generic payment JSON routes still require the same transport review before they can be claimed as bounded. They are intentionally not described as complete here.

## Validation

`src/server/bookings/hospitality-booking-http.test.ts` covers JSON-object enforcement, media type, advertised and streamed size bounds, strict UTF-8 decoding, and caller-specific limits. `scripts/authenticated-hospitality-core-json-ingress-contract.test.mjs` prevents the covered routes from returning to raw `request.json()`.

Full repository validation still requires the repository Node 24.20+ toolchain and the disposable PostgreSQL gates documented in the development guide. GitHub Actions are not used.
