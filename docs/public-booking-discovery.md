# Public Hospitality Discovery

## Status

SF now has a real tenant-branded public hospitality discovery surface at `/book/[organization-slug]`. It resolves an active organization from the canonical public slug, applies only public-safe branding/contact fields, and searches the same persisted hospitality inventory, restrictions, live holds, booking allocations, and exact pricing data used by staff operations.

This is intentionally **not** presented as completed self-service booking. The public page can prove current sellable offers and current stay totals, but it does not create capacity holds, customers, bookings, or payments. Until a customer-safe ownership/authentication and payment-collection contract exists, the UI exposes no fake `Book now` action. Where a real tenant contact channel is configured, an offer can link to that real channel and explicitly states that live availability is not a held room.

## Public tenant boundary

The browser never supplies an organization ID. `readPublicOrganizationBrandingBySlug` canonicalizes the route slug and resolves only an `ACTIVE`, non-deleted organization. `searchPublicHospitalityOffers` derives the organization ID from that server-side result before calling the shared hospitality search core.

Inactive, deleted, malformed, or unknown tenants therefore cannot be selected by changing a hidden organization identifier. The public branding payload excludes internal email-delivery settings and other operator-only configuration.

## Shared availability and pricing core

Staff APIs retain their existing authenticated permission checks. Public discovery does not create a synthetic user or weaken those APIs.

Instead, availability now exposes a server-only tenant-scoped core, `readHospitalityAvailabilityForOrganization`, while `readHospitalityAvailability` remains the authenticated `availability:read` wrapper. The shared core revalidates that the organization is active and keeps every resource, restriction, hold, allocation, and capacity query scoped by `organizationId`.

Offer search follows the same pattern. `searchHospitalityOffersForOrganization` is the server-only tenant-scoped core; `searchHospitalityOffers` remains the authenticated wrapper requiring both `availability:read` and `pricing:read`.

Search also uses `quoteHospitalityPriceFromReader`, the same persisted transactional pricing calculation used by booking confirmation. This avoids a separate public pricing implementation and reduces the risk that discovery and confirmation calculate commercial totals differently.

## Customer-facing behavior

The public page provides:

- tenant logo, colors, controlled font stack, booking title/description, and favicon;
- accessible arrival, departure, and room-quantity controls;
- bounded live offer discovery with truncation disclosure;
- real property, room type, rate plan, capacity, occupancy, stay length, and exact-money totals;
- customer-safe validation/error states without raw server or provider errors;
- responsive layouts and visible keyboard focus;
- explicit messaging that availability/pricing can change until a reservation is confirmed.

The page does not expose internal resource IDs in form inputs, pricing fingerprints, audit data, provider credentials, or staff APIs.

## Remaining public booking dependency

A complete public booking journey still requires a deliberate customer-safe write boundary for capacity holds, customer/guest ownership, booking confirmation, and Stripe payment collection/retry. Those writes must not reuse staff `booking:manage` authority and must include abuse controls, durable idempotency, tenant/resource ownership, payment proof, and safe recovery states.

Until that contract is implemented end to end, Phase 11 remains incomplete even though real public discovery is now available.

## Validation

The implementation reuses the existing normalized search, availability, restriction, capacity, exact-money pricing, and tenant-scope validation rather than introducing parallel public domain logic. Full repository typecheck, lint, Prisma/database verification, tests, and production build still require the repository's Node 24 runtime and the documented disposable PostgreSQL target. GitHub Actions are intentionally not used.
