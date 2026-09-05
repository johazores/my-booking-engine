# Request correlation and structured logging

SF uses bounded request correlation on production workflows where operators need to connect an HTTP outcome to one privacy-safe server completion record. Coverage is added only after the route's authority and privacy boundary has been reviewed; request logging is not a reason to copy application payloads into logs.

Current reviewed coverage includes authentication, tenant administration, customer lifecycle mutations, hospitality inventory management, pricing management, core authenticated/public hospitality booking flows, legal-document issuance, payments and commercial-amendment payment transport, Stripe Checkout/webhook ingress, and integration management.

## Request ID contract

Instrumented routes accept `x-request-id` only when its normalized value is 8 to 128 characters and uses the bounded identifier alphabet in `src/lib/request-correlation.ts`. Missing or invalid values are replaced with a cryptographically random UUID. The selected ID is returned in the `x-request-id` response header on success, validation/auth rejection, conflict, and server failure.

A request ID is correlation metadata only. It grants no authentication, tenant, booking, payment, provider, customer, inventory, pricing, or legal-document authority and is never used as an idempotency key.

Staff legal-document issuance actions may append a validated response request ID to visible failure text as a support reference. Other clients do not need to echo or display the ID for the server to create a correlated completion record.

## Structured completion record

`src/server/observability/request-observability.ts` emits exactly one JSON completion record for each instrumented request. The record is an explicit safe whitelist:

- timestamp, level, event, request ID, operation, outcome, HTTP status, and elapsed milliseconds;
- organization ID only after authenticated tenant authority has been established, or after a Stripe webhook has crossed its configured integration and signature-verification boundary;
- optional booking reference/provider code only for server-owned callers with a separately reviewed safe value;
- legal document type for the current issuance routes.

HTTP 2xx/3xx outcomes log at `info`, 4xx rejections at `warn`, and 5xx failures at `error`. Optional identifiers fail closed when they do not match the bounded log-safe format.

Redirect form handlers may provide the shared logger a typed `rejected` or `failed` logical outcome after the server has classified the operation. This is only for HTTP 303 workflows whose business operation failed. An HTTP 5xx can never be downgraded, and callers cannot override an HTTP failure to `succeeded`.

## Reviewed operations

Authentication:

- `auth.sign-in`
- `auth.sign-up`
- `auth.sign-out`

Tenant administration:

- `organization.create`
- `organization.select`
- `organization.settings.update`
- `organization.branding.update`
- `organization.archive`
- `organization.membership.role.update`
- `organization.membership.status.update`

Customer lifecycle:

- `customer.create`
- `customer.update`
- `customer.archive`
- `customer.deidentify`

Hospitality inventory management:

- `inventory.amenity.create`
- `inventory.amenity.archive`
- `inventory.property-amenity.mutate`
- `inventory.room-type-amenity.mutate`
- `inventory.image.mutate`
- `inventory.property.create`
- `inventory.property.archive`
- `inventory.rate-plan.create`
- `inventory.rate-plan.archive`
- `inventory.rate-plan-room-type.mutate`
- `inventory.restriction.create`
- `inventory.restriction.archive`
- `inventory.room-type.create`
- `inventory.room-type.archive`
- `inventory.room.create`
- `inventory.room.archive`

Pricing management:

- `pricing.addon.create`
- `pricing.addon.archive`
- `pricing.base-rate.create`
- `pricing.base-rate.archive`
- `pricing.charge.create`
- `pricing.charge.archive`

Authenticated hospitality booking:

- `booking.hospitality-hold.create`
- `booking.hospitality-confirmation.create`
- `booking.hospitality-cancellation.apply`
- `booking.hospitality-guests.update`
- `booking.hospitality-commercial-modification.apply`
- `booking.hospitality-commercial-modification.preview`
- `booking.hospitality-reschedule.apply`
- `booking.hospitality-commercial-amendment.prepare`
- `booking.hospitality-commercial-amendment.apply`
- `booking.hospitality-commercial-amendment.cancel`

Legal documents:

- `hospitality-tax-invoice.issue`
- `hospitality-cancellation-adjustment-note.issue`
- `hospitality-commercial-adjustment-note.issue`

Authenticated payments:

- `payment.manual.record`
- `payment.manual-refund.record`
- `payment.stripe.reconcile`
- `payment.stripe-refund.create`
- `payment.stripe-refund.reconcile`
- `payment.receipt.read`
- `payment.transactions.read`

Commercial-amendment payments:

- `payment.commercial-amendment.manual-settlement`
- `payment.commercial-amendment.stripe-checkout.create`
- `payment.commercial-amendment.stripe-checkout.reconcile`
- `payment.commercial-amendment.stripe-refund.create`
- `payment.commercial-amendment.stripe-refund.reconcile`
- `payment.commercial-amendment.stripe-recovery-checkout.create`
- `payment.commercial-amendment.stripe-recovery-checkout.reconcile`

Integration management:

- `integration.stripe.configure`
- `integration.stripe.connection-test`
- `integration.lifecycle.update`

Public/provider ingress:

- `public-booking.hospitality-hold.create`
- `public-booking.hospitality-hold.release`
- `public-booking.hospitality-quote.read`
- `public-booking.hospitality-confirmation.create`
- `public-payment.stripe-checkout.create`
- `public-payment.stripe-checkout.status`
- `payment.stripe-webhook.ingest`

## Authority and privacy boundaries

Authentication logs intentionally have no organization, user, email, or session scope. Submitted email/password/display name, cookies/tokens/digests, redirect URLs, and raw authentication errors are excluded. Expected form failures are `rejected`; unexpected service failures are `failed`. Sign-out revocation failure returns an observed HTTP 500 and leaves the browser session cookie intact rather than presenting a local sign-out after durable revocation failed.

Organization creation attaches organization scope only after the tenant and initial membership exist. Organization selection does not log the requested organization ID and adds scope only after membership is proven. Settings, branding, archive, and membership mutations add organization scope only after the authenticated active-tenant context resolves. Names/slugs/branding/contact data, membership IDs, roles/statuses, actor user IDs, form bodies, URLs, and raw errors are excluded.

Customer mutation logs add only the active organization ID, and only after authenticated active-tenant resolution. Customer IDs, names, email, phone, notes, search/query data, form bodies, route URLs, and raw errors are not copied into request-log scope. Existing customer services remain responsible for `customer:manage`, tenant/resource ownership, lifecycle rules, and durable audit evidence.

Hospitality inventory mutation routes share `prepareInventoryMutationRequest`, which applies same-origin/form ingress checks, session resolution, active-tenant resolution, request correlation, and fail-closed infrastructure error handling before an organization ID may enter the completion record. Property, room-type, room, amenity, image, rate-plan, restriction, assignment, date/rule, confirmation, and form values are excluded from log scope. Malformed form payloads are validation rejections. Multi-action routes explicitly reject unknown action values instead of treating an unrecognized value as a write default. Existing inventory services remain responsible for `inventory:manage`, tenant/property/resource ownership, dependency/lifecycle rules, serializable writes, and audit evidence.

Pricing management logs add organization scope only after authenticated active-tenant resolution. Property/room-type/rate-plan/add-on/base-rate/charge identifiers, monetary amounts, percentages, dates, scope selections, form bodies, URLs, and raw errors are excluded. Malformed form payloads are validation rejections. Existing pricing services retain `pricing:manage`, commercial-scope validation, advisory locking, serializable persistence, and audit authority.

Authenticated hospitality booking logs attach organization scope only after `requireHospitalityBookingApiContext` establishes the active-tenant write context. Booking/amendment IDs, hold payloads, commercial changes, traveler data, dates, pricing fingerprints, idempotency keys, and request bodies are excluded. Booking/payment services retain `booking:manage`, `payment:manage` where required, tenant ownership, concurrency, and commercial authority.

Authenticated payment routes attach organization scope only after `requirePaymentApiContext`. Commercial-amendment payment routes attach it only after the hospitality booking write context. Request-body booking/transaction/amendment IDs, idempotency keys, manual references, return URLs, provider references, and query selectors are excluded. Provider scope uses only reviewed static labels such as `manual` or `stripe`.

Integration-management logs attach organization scope only after active-tenant resolution. Stripe configuration/test routes may include only the static provider label `stripe`; credentials, webhook secrets, provider responses/account metadata, integration IDs, lifecycle actions, URLs, and raw errors are excluded. Integration services retain `integration:manage`, tenant ownership, encrypted credential handling, lifecycle preconditions, and provider-adapter boundaries.

Capability-owned public booking and Stripe Checkout routes record no tenant or booking identifier. Organization slug, booking/hold capability, request keys, pricing fingerprints, add-ons, customer/contact/guest data, return URLs, bodies, and route selectors are excluded. These operations keep their existing same-origin and persisted capability/ownership authority.

For Stripe webhooks, the route parameter is never trusted as log scope on arrival. Organization scope is attached only after `ingestStripePaymentWebhook` loads the tenant-scoped Stripe integration and verifies the configured signature. The raw body, signature, provider event payload, and provider references are never copied into request logs.

## Data that must never enter these logs

Do not add raw URLs/query strings, request/response bodies, arbitrary headers, cookies, authorization headers, passwords, bearer/capability/session tokens, session digests, customer/guest identity or contact data, addresses, card data, API/webhook secrets, provider payloads, legal-document snapshots, or raw caught error objects/messages.

Booking, customer, inventory, pricing, amendment, integration, membership, and payment/provider identifiers; pricing/request fingerprints; idempotency keys; lifecycle form actions; dates; quantities; and money also require a separate reviewed operational need before they can become structured fields.

The logger deliberately accepts a typed whitelist rather than arbitrary metadata objects. New fields must preserve that model.

## Operations and future sinks

JSON lines currently use the application runtime console so container/process log collection can ingest them without a provider-specific logging dependency. Replacing that transport with a hosted log sink must not change the request-correlation contract or weaken the safe-field whitelist.

Use `x-request-id` as the primary correlation key when investigating an instrumented failure. Organization ID and operation can narrow authenticated/verified-provider searches only when those values crossed their reviewed authority boundary.

This logging layer does not replace customer, inventory, pricing, booking, payment, integration, tenant, or legal-document audit/history. Durable business evidence and operational request logs have different retention requirements.

Coverage should continue only through individually reviewed production boundaries. Do not mechanically instrument a route by copying request data into log scope.

## Validation

- `scripts/request-observability.test.mjs` covers correlation-ID validation/echo, status/level classification, safe optional fields, forbidden-data leakage, legal-document integrations, and staff failure references.
- `scripts/payment-request-observability.test.mjs` covers authenticated/commercial-amendment payment tenant ordering, public Stripe privacy, webhook authority ordering, and completion routing.
- `scripts/booking-request-observability.test.mjs` covers authenticated booking tenant ordering plus public booking capability/tenant/pricing/customer-data exclusion.
- `scripts/integration-request-observability.test.mjs` covers redirect-aware logical outcomes, tenant ordering, static Stripe provider scope, and integration action/ID exclusion.
- `scripts/identity-tenant-request-observability.test.mjs` covers authentication and tenant administration, redirect outcome classification, fail-closed sign-out revocation, post-authority tenant scope, and identity/membership/form-data exclusion.
- `scripts/customer-request-observability.test.mjs` covers all current customer lifecycle mutations, post-authority tenant scope, infrastructure failure handling, redirect classification, and PII/resource-ID exclusion.
- `scripts/pricing-request-observability.test.mjs` covers all current pricing management mutations, post-authority tenant scope, malformed-form validation, redirect classification, and commercial/resource-data exclusion.
- `scripts/inventory-request-observability.test.mjs` covers all 16 current inventory management mutation routes, the shared tenant boundary, malformed-form validation, redirect classification, inventory/form-data exclusion, and strict unknown-action rejection.

Full repository validation still requires the repository Node 24 toolchain and, for database-backed suites, an explicitly disposable PostgreSQL target. This observability work does not change the Prisma persistence contract. GitHub Actions are not used for validation.
