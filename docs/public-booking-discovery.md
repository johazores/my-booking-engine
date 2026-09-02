# Public Hospitality Discovery

## Status

SF has a real tenant-branded public hospitality booking surface at `/book/[organization-slug]`. Discovery is the first stage of the connected self-service journey rather than a standalone mock: the same page can proceed from a live persisted offer into a tenant-scoped hold, current-price review, customer/guest capture, capability-owned confirmation, Stripe-hosted Checkout, and authoritative payment recovery.

The route resolves an active organization from the canonical public slug, applies only public-safe branding/contact fields, and searches the same persisted hospitality inventory, restrictions, live holds, booking allocations, and exact pricing data used by staff operations. The browser never chooses `organizationId`.

## Public tenant boundary

`readPublicOrganizationBrandingBySlug` canonicalizes the route slug and resolves only an `ACTIVE`, non-deleted organization. `searchPublicHospitalityOffers` derives the organization ID from that server-side result before calling the shared hospitality search core.

Inactive, deleted, malformed, or unknown tenants therefore cannot be selected by changing a hidden organization identifier. Public writes continue deriving tenant ownership from the route slug plus opaque capabilities and persisted public-principal ownership; they do not reuse staff permission wrappers.

The public branding payload excludes internal email-delivery settings and other operator-only configuration.

## Shared availability and pricing core

Staff APIs retain their authenticated permission checks. Public discovery does not create a synthetic user or weaken those APIs.

Availability exposes a server-only tenant-scoped core, `readHospitalityAvailabilityForOrganization`, while `readHospitalityAvailability` remains the authenticated `availability:read` wrapper. The shared core revalidates that the organization is active and keeps every resource, restriction, hold, allocation, and capacity query scoped by `organizationId`.

Offer search follows the same pattern. `searchHospitalityOffersForOrganization` is the server-only tenant-scoped core; `searchHospitalityOffers` remains the authenticated wrapper requiring both `availability:read` and `pricing:read`.

Search uses `quoteHospitalityPriceFromReader`, the same persisted pricing calculation used by hold review and booking confirmation. Discovery prices are informative until a hold exists; final confirmation requires the fresh capability-owned quote fingerprint and recalculates persisted pricing transactionally.

## Customer-facing behavior

The public page provides:

- tenant logo, colors, controlled font stack, booking title/description, favicon, and configured contact channels;
- accessible arrival, departure, and room-quantity controls;
- bounded live offer discovery with explicit truncation disclosure;
- real property, room type, rate plan, sellable capacity, occupancy, stay length, and exact-money totals;
- a real `Reserve this stay` action backed by the public hold service rather than a contact-only or fake booking CTA;
- server-reviewed price and hold expiry before customer details are submitted;
- customer/primary-guest collection followed by capability-owned confirmation and Stripe Checkout;
- same-tab payment recovery that reports completion only from authoritative server/provider state; and
- responsive loading, empty, validation, error, retry, hold-release, and payment-recovery states.

The page does not submit tenant IDs or internal idempotency keys as authority. Internal resource IDs used to describe the selected offer are revalidated against the tenant and capability-owning server workflow before any commercial write.

## Connected write and payment boundaries

Discovery itself remains read-only. The connected mutation stages are documented separately so ownership and failure semantics stay explicit:

- `docs/public-booking-write-boundary.md` — hold/public-principal ownership and mutation rules;
- `docs/public-booking-quote-and-release.md` — current-price review and hold release;
- `docs/public-booking-confirmation.md` — customer/guest attachment, atomic confirmation, and payment-start window; and
- `docs/public-booking-payments.md` — Stripe Checkout, signed lifecycle recovery, abandonment, and payment status.

A temporary hold or browser redirect is never represented as a paid reservation. Capacity protection and final booking/payment state come from persisted server state.

## Validation

The implementation reuses the existing normalized search, availability, restriction, capacity, exact-money pricing, tenant-scope, hold, confirmation, and payment domains rather than introducing parallel public business logic. Focused dependency-free public-booking tests cover capability/idempotency/recovery decisions, and guarded PostgreSQL scenarios are registered in `npm run test:database` for ownership, capacity, confirmation, and payment persistence.

Full repository validation requires the repository Node 24 toolchain. Database execution requires an explicitly confirmed disposable PostgreSQL target. GitHub Actions are intentionally not used.