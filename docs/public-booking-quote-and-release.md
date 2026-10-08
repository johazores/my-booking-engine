# Public booking quote and release boundary

## Status

SF exposes a customer-safe lifecycle around an anonymous hospitality hold without weakening the staff booking authorization model.

`POST /api/public-bookings/[organization-slug]/hospitality/holds` creates the tenant-scoped hold and returns an opaque expiring capability. `DELETE` on the same route releases that hold only after the capability and persisted public ownership are both revalidated. All public write responses are `no-store` and all writes require a matching `Origin`.

`POST /api/public-bookings/[organization-slug]/hospitality/quote` revalidates the active capability-owned hold and recalculates current persisted pricing for that exact held stay. It accepts only optional add-on selections; property, room type, rate plan, dates, quantity, and tenant scope are derived from the persisted hold rather than trusted from the browser.

## Customer-safe quote

The quote boundary uses the same `quoteHospitalityPriceFromReader` calculation used by booking confirmation. The response includes exact-money nightly amounts, taxes, fees, add-ons, totals, the pricing fingerprint, and hold expiry. It deliberately excludes organization IDs, principal IDs, hold IDs, property IDs, room-type IDs, and rate-plan IDs.

An expired capability, ended hold, missing ownership row, principal mismatch, or cross-tenant slug/capability combination fails closed as unavailable. Pricing that can no longer be produced returns a retryable commercial conflict instead of silently falling back to discovery-time prices.

## Release semantics

Public release calls the canonical allocation-locked hold release transaction. That keeps release serialized with competing hold creation and booking confirmation. Releasing an already ended hold remains idempotent according to the existing hold core, and public audit attribution is written only when the state actually changes.

The public booking client also treats a successful hold followed by a failed quote as an abandoned reservation attempt. It immediately calls the authenticated-by-capability release boundary instead of knowingly leaving inventory held until TTL expiry. If that cleanup request cannot be confirmed because of a network/server failure, the capability remains in client state and the error UI exposes an explicit release action; the browser does not pretend cleanup succeeded.

## HTTP policy

`src/server/bookings/public-booking-http-policy.ts` centralizes the same-origin policy and bounded JSON object parser used by public booking mutations. Missing, malformed, and cross-origin `Origin` values are denied. JSON bodies must use `application/json`, decode as valid UTF-8, and parse to an object. Hold create/release, quote, and confirmation use the shared 64 KiB streamed ceiling even when `Content-Length` is absent. The capability-focused payment receipt, Stripe Checkout creation, and Stripe Checkout status routes reuse the same reader with tighter 8 KiB route ceilings and reject empty or over-4,096-character booking capabilities before service-level verification.

## Journey integration

The hold and quote boundaries are now connected to the real public booking journey. A customer can select a live offer, create the bounded hold, review server-recalculated pricing, provide customer/primary-guest details, confirm through the capability-owned booking boundary, and continue to hosted Stripe Checkout. Hold failure, quote failure, explicit release, confirmation failure, payment recovery, and terminal payment states remain explicit rather than being represented as fake success.

## Validation

The customer-safe quote projection and shared same-origin policy have dependency-free Node tests. Public payment-recovery domain tests additionally cover the safe continuation states used after hosted Checkout returns. Full typecheck, lint, Prisma validation, PostgreSQL integration coverage, and production build still require the repository Node 24 environment and disposable database target documented in the development guide. GitHub Actions are not part of this validation process.

## Client-side overlapping-action and malformed-quote safety

Each public offer card serializes its own hold creation, confirmation, and release actions in the browser as well as relying on the server's authoritative locking/idempotency. A release enters a dedicated pending state so customers cannot submit confirmation or another release while the first release is unresolved. An uncertain release keeps the original hold capability and offers a direct retry; the UI clears it only after the release endpoint confirms success. A failed quote after successful hold creation still triggers best-effort release and preserves the capability if cleanup cannot be confirmed.

The client checks the fields needed for reviewed pricing (currency, bounded exact nonnegative minor-unit amount, fingerprint, and parseable expiry) before displaying the confirmation form. An incomplete/malformed quote follows the same release/retry path instead of crashing while rendering a price. These browser checks do not replace server-side tenant, capability, inventory, expiry, and pricing revalidation.

The dependency-free `scripts/public-booking-hold-client-lifecycle-contract.test.mjs` guards these UI state transitions. Full Next.js/TypeScript and disposable PostgreSQL validation remains required in the documented Node 24 environment.

## Malformed public response handling

The browser's shared public booking response reader normalizes malformed, empty, null, array, and primitive JSON bodies to an empty object. It preserves only nonblank string error messages on unsuccessful HTTP responses, otherwise showing a safe generic request error. This prevents raw JavaScript property-access exceptions from reaching customer-facing hold, confirmation, Checkout, and recovery states. The existing server-side tenant, capability, and payment-authority checks remain unchanged.

The hold lifecycle contract includes focused executable parser cases for malformed success and error responses. Full repository Node 24 and PostgreSQL validation is still pending in an appropriately provisioned environment.
