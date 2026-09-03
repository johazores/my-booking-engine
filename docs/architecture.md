# SF Architecture

## Status

This document describes the target architecture and identifies what exists today. It must not be read as a claim that every module is already implemented.

## Current foundation

SF currently uses a modular Next.js application with PostgreSQL/Prisma persistence. The implemented data foundation contains organizations, users, organization memberships, password credentials, persisted opaque authentication sessions, organization/platform roles, audit events, tenant-owned white-label presentation settings, tenant-owned customer records, hospitality inventory covering properties, room types, physical rooms, amenities, hosted-image metadata, property-owned rate plans with room-type assignments, date/stay/arrival restrictions, availability windows, temporary availability holds, nightly base rates, persisted hospitality tax/fee rules, persisted hospitality add-ons, confirmed hospitality bookings, permanent booking allocations, append-only accepted-state booking pricing evidence, payment transactions, payment Checkout sessions, and versioned hospitality commercial amendments.

First-party email/password authentication is implemented through server-side App Router flows with secure session cookies and protected server-rendered access. Organization reads are tenant-scoped, and authenticated users can create a tenant atomically with their membership, choose an active organization context, manage permitted organization settings/membership lifecycle, archive organizations without destroying commercial history, manage white-label branding where authorized, operate a tenant-scoped customer directory, manage hospitality inventory, configure availability and pricing, operate the authenticated hospitality booking desk, and manage real tenant integration configuration where authorized. The active organization cookie is only a preference: every context read revalidates the authenticated user's active membership server-side.

Fine-grained authorization is implemented through centralized organization capabilities and server-side permission checks. `/dashboard`, `/bookings`, `/customers`, `/inventory`, `/pricing`, `/integrations`, `/account`, and `/branding` share the canonical authenticated workspace. Tenant branding is resolved at that server boundary and applied through CSS design tokens rather than tenant-specific component overrides. Customer, inventory, availability, pricing, booking, payment, commercial-amendment, and integration operations reuse the same authorization, audit, lifecycle, pagination, and tenant-scope principles.

Hospitality availability normalizes property/room-type/rate-plan/date/quantity requests, validates active tenant-owned assignments, derives baseline capacity from active physical rooms, applies capacity windows and effective restrictions, and subtracts both active unexpired holds and non-cancelled permanent booking allocations per occupied night. Hold creation and hold-to-booking confirmation use the shared room-type allocation advisory lock. Confirmation creates the permanent allocation and consumes the hold atomically, so capacity cannot reopen between those operations. Commercial amendments reuse the same inventory protection model for target room/quantity changes and revalidate target sellable capacity before final apply.

Hospitality pricing has a normalized money boundary, persisted nightly base rates, persisted taxes/fees, and persisted add-ons. Base prices, fixed charges, and add-ons are stored in integer minor units with explicit currency, percentage charges use integer basis points, ambiguous overlapping commercial rules are prevented, and server-side quote/revalidation services produce deterministic complete-price fingerprints. Booking confirmation recalculates current complete pricing inside its serializable transaction and persists the authoritative aggregate accommodation/tax/fee/add-on/total snapshot and pricing identity before confirmation commits. Newly accepted booking states also persist canonical line-item pricing evidence separately from the mutable booking row. Zero-delta modifications and same-price reschedules refresh the accepted fingerprint and append pricing evidence when terms/dates change without changing aggregate money. Non-zero room/rate/quantity/add-on changes use the versioned commercial-amendment lifecycle, which freezes target pricing evidence before settlement, rather than rewriting booking/payment truth directly.

Payments are implemented through a provider-neutral contract with manual/offline behavior and a real Stripe adapter. SF persists tenant-owned payment evidence, supports authorization/capture, hosted Checkout, signed webhooks, polling reconciliation, provider-aware refunds, customer-safe receipts, public payment recovery, commercial-amendment settlement, and compensation recovery. Browser redirects never prove payment. Jurisdiction-specific legal invoice/tax-document issuance is intentionally separate and remains incomplete.

## Architectural shape

SF is a modular monolith:

```text
presentation / routes
        ↓
application services
        ↓
booking + commercial domains
        ↓
provider contracts
        ↓
provider adapters
```

The core application must never become directly coupled to Amadeus, Sabre, Travelport, Stripe, PayPal, SMTP, SMS providers, storage vendors, or other external systems.

## Modules

Implemented foundation/operational modules:

- authentication
- organizations
- memberships
- roles and permissions
- tenant settings
- branding
- customer directory
- hospitality inventory: properties, room types, rooms, amenities, images, rate plans, and restrictions
- hospitality availability: physical capacity, windows, restrictions, temporary holds, expiry semantics, permanent booking allocations, and no-overbooking locking
- hospitality pricing: normalized money, nightly base rates, taxes/fees, add-ons, complete quotes, transactional revalidation, booking pricing identity, and immutable accepted-state pricing evidence
- hospitality bookings: public/internal creation, immutable guest and aggregate price snapshots, lifecycle/payment state separation, authenticated management, history, cancellation, same-price date rescheduling, traveler edits, zero-delta commercial edits, and versioned non-zero commercial amendments
- payments: manual/offline, Stripe authorization/capture, hosted Checkout, webhooks, reconciliation, refunds, receipts, and recovery
- tenant integration management with encrypted credentials, capabilities, lifecycle, health testing, and Stripe configuration
- audit history foundation

Planned/conditional modules:

- first external supplier/GDS and normalized supplier search/availability/pricing/reservation adapters
- additional supplier/payment/email/SMS providers only when product-prioritized
- advanced tenant/provider pricing rules when concrete requirements exist
- price-changing date rescheduling only if product requirements justify extending the amendment stay/inventory contract
- jurisdiction-specific legal invoice/tax-document issuance
- remaining business-specific inventory/workflows for tours, appointments, rentals, and later advanced modules

Business-specific capabilities extend the common booking foundation only where concepts genuinely overlap. Hotel rooms, tours, appointments, and rentals are not forced into one meaningless generic entity. Customer/contact identity is shared, while hospitality bookings persist immutable ordered guest snapshots with their own booking lifecycle.

## Runtime boundaries

- UI components render product state and collect input.
- Route handlers validate and coordinate requests.
- Application services own workflows.
- Domain modules own business rules and state transitions.
- Repository/data-access modules enforce tenant ownership.
- Provider adapters translate normalized operations to external APIs.

Authenticated tenant operations derive user identity from the validated server session and revalidate organization membership at the server/data-access boundary. Browser route parameters, form values, cookies, provider redirects, or client-calculated totals are never sufficient tenant/payment/commercial authority.

Single-resource tenant operations use both tenant identity and resource identity. Hospitality parent relationships additionally use composite foreign keys so room types, rooms, amenities, images, rate-plan assignments, restrictions, availability records, pricing records, holds, bookings, allocations, accepted-state booking pricing evidence, amendment-owned payment transactions, and commercial amendments cannot cross organization/property/booking boundaries even if application validation is bypassed.

The application shell may display already-resolved user, tenant, role, and branding context, but it is never an authorization boundary. Protected pages and server operations remain responsible for enforcing their own access requirements.

## White-label presentation boundary

White-label settings are organization-owned data, not a client-only theme. The management service requires `organization-settings:manage`, validates canonical values, writes material updates transactionally, and records audit history.

The authenticated shell converts persisted primary/secondary/accent colors and controlled typography into CSS custom properties. Shared components consume those tokens, which prevents scattered tenant-specific hardcoded colors. A configured logo and favicon are also resolved from the active tenant.

The public-safe branding reader exposes only values suitable for customer-facing surfaces. The real `/book/[organization-slug]` journey applies persisted branding to live hospitality discovery, pricing/hold/confirmation, and payment completion/recovery. Persisted custom-domain hostname configuration does not imply DNS ownership verification or custom-host routing; those remain distinct deployment concerns.

## Customer boundary

Customer data is tenant-owned operational data. `customer:read` protects directory/detail/history reads and `customer:manage` protects create/edit/archive. Staff and managers can operate the customer directory; customer-role members receive no organization-wide directory access.

Archived customers are preserved rather than deleted. Audit events record lifecycle/activity without duplicating internal notes or credentials into audit JSON.

Hospitality booking confirmation persists ordered immutable guest snapshots independently from the mutable reusable Customer record. Later traveler edits operate only on those booking-owned snapshots with booking authorization, occupancy checks, idempotency, and PII-minimized audit evidence.

## Hospitality inventory boundary

Hospitality inventory uses explicit property → room type → room relationships. Amenities remain reusable tenant-owned definitions with explicit property/room-type assignments. Images use explicit property and room-type metadata records rather than a polymorphic media blob. Rate plans are property-owned commercial identities with explicit room-type assignments. Restrictions remain separate date-scoped commercial rules linked to those stable identities.

`inventory:read` protects reads; `inventory:manage` protects writes. Managers can manage inventory, staff have read-only inventory access, and customer-role members have none. Composite database foreign keys reinforce tenant-consistent parent relationships in addition to server-side scoped services.

Rate plans deliberately stop at commercial identity. Restrictions add minimum/maximum stay and closed-to-arrival/departure behavior without storing prices. Pricing, availability allocation, and booking state remain separate concerns even when they reference the same room type/rate plan scope.

Inventory archival is explicit, dependency-aware where relationships must be cleared, and audited. Hosted image management accepts real HTTPS assets; a future direct-upload feature must sit behind a real storage adapter rather than leaking provider APIs into the inventory domain.

## Availability boundary

The normalized availability request shape is provider-independent. Hospitality availability requires active property, room type, and rate-plan assignment within the authenticated organization, counts only active physical rooms, applies active capacity windows/effective restrictions, and subtracts active unexpired holds plus non-cancelled permanent allocations per occupied night.

`availability:read` protects operational reads. Managers/admins have `availability:manage`; staff are read-only and customer-role members have no organization availability access. Hold allocation, physical-capacity changes, booking confirmation, and inventory-changing booking management use shared/deterministic PostgreSQL advisory-lock scopes so competing last-unit operations are serialized.

Temporary holds are converted to permanent allocation only by the booking confirmation transaction. The transaction revalidates the tenant-owned active unexpired hold under the shared allocation lock, creates the booking/allocation, marks the hold `CONSUMED`, and commits those changes together. Commercial amendments can hold target incremental/full protection while prepared; final apply revalidates the exact hold/protection and fresh capacity before replacing the booking allocation. The internal hospitality policy remains no overbooking.

## Pricing boundary

Pricing uses exact integer minor units and explicit currency rather than binary floating-point amounts. `pricing:read` protects quotes/configuration reads; `pricing:manage` protects base-rate, tax/fee, and add-on writes. Managers/admins can manage pricing, staff are read-only, and customer-role members have no internal pricing access.

Base rates, charge rules, and add-ons are immutable-in-practice commercial history: changes are represented by archiving old records and creating new date windows. Concurrent writes serialize on commercial scope/code boundaries before overlap validation.

The normalized complete quote composes accommodation, percentage taxes/fees, fixed-per-booking charges, fixed-per-room-night charges, and selected add-ons using exact arithmetic. Complete-price revalidation compares a deterministic fingerprint that includes all applied commercial identities/amounts. Browser totals are never authoritative.

Booking confirmation re-reads current persisted pricing and recalculates the complete quote inside the same serializable transaction as hold consumption and permanent allocation. A stale fingerprint aborts before booking, allocation, hold-consumption, or audit writes commit. Successful confirmation persists authoritative aggregate exact-money fields and the accepted pricing fingerprint.

Accepted-state pricing evidence is persisted in the separate `HospitalityBookingPricingEvidence` table rather than continually mutating one JSON field on the booking. Each row freezes the organization/booking ownership, observed booking version, commercial scope and stay, normalized add-on selections, aggregate exact money, pricing fingerprint, and schema-versioned nightly/tax/fee/add-on breakdown. The evidence domain validates line identities, labels, calculations, quantities, date coverage, duplicate lines, and aggregate reconciliation before persistence. Tenant/resource composite foreign keys and database checks reinforce those invariants.

Confirmation, same-price rescheduling, and zero-delta commercial modification append evidence in the same protected transaction as the accepted state. Non-zero commercial-amendment preparation freezes target pricing evidence before amendment-owned provider settlement starts. Pre-migration bookings can legitimately lack such evidence; SF does not backfill historical lines from today's mutable commercial configuration. This pricing evidence is a legal-data prerequisite, not a claim of invoice issuance. Immutable issuer/tax registration, jurisdiction/tax semantics, billing authority, fiscal numbering, legal document lifecycle, required wording, rendering/delivery, retention, and accounting contracts remain incomplete. See `docs/invoice-foundation.md`.

## Booking and commercial-amendment boundary

The provider-independent booking command references a tenant-owned availability hold and active customer, requires a strict organization-scoped idempotency key, carries the expected complete-pricing fingerprint, and includes normalized selected add-ons/guests. The browser never supplies authoritative totals.

Authenticated booking APIs derive the organization from validated server tenant context and expose real availability, hold, quote, confirmation, history, management, payment, refund, and commercial-amendment operations. The authenticated `/bookings` desk coordinates those APIs and reuses canonical server services rather than reproducing availability, pricing, settlement, or authorization rules in UI code.

Hold and booking request keys are stable across retryable client failures. Confirmation takes both the booking idempotency lock and shared allocation lock, so a lost response can be retried safely while competing requests cannot consume the same final hold twice.

General room/rate/quantity/add-on modification has two deliberate paths. A zero-delta change can apply directly only after complete current pricing proves all persisted aggregate money remains unchanged. A non-zero reviewed delta creates a versioned `HospitalityBookingCommercialAmendment` that freezes source booking version and before/after commercial identity, protects target inventory, freezes the target line-item pricing evidence, attributes all adjustment money to the amendment, converges provider truth through manual/Stripe adapters, and permits final mutation only from `READY_TO_APPLY` inside the serializable apply service. Expired or post-settlement-conflicted amendments enter explicit reconciliation/compensation recovery rather than applying stale booking terms.

The public tenant-branded hospitality flow is also implemented through real discovery → hold → quote → guest/customer → confirmation → Stripe-hosted Checkout → signed/provider-truth completion and recovery. Public principals/capabilities do not grant staff tenant permissions.

The largest remaining cross-provider dependency is the first real external supplier/GDS adapter. Jurisdiction-specific invoice/tax-document issuance and product-specific price-changing date amendment semantics remain separate future contracts.

## Scaling restraint

Do not introduce microservices, queues, or event-driven architecture until a concrete asynchronous or operational requirement justifies them. The modular monolith should preserve clean boundaries so future extraction remains possible.
