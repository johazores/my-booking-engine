# SF Architecture

## Status

This document describes the target architecture and identifies what exists today. It must not be read as a claim that every module is already implemented.

## Current foundation

SF currently uses a modular Next.js application with PostgreSQL/Prisma persistence. The implemented data foundation contains organizations, users, organization memberships, password credentials, persisted opaque authentication sessions, organization/platform roles, audit events, tenant-owned white-label presentation settings, tenant-owned customer records, hospitality inventory covering properties, room types, physical rooms, amenities, hosted-image metadata, property-owned rate plans with room-type assignments, date/stay/arrival restrictions, availability windows, temporary availability holds, nightly base rates, persisted hospitality tax/fee rules, persisted hospitality add-ons, confirmed hospitality bookings, and permanent booking allocations.

First-party email/password authentication is implemented through server-side App Router flows with secure session cookies and protected server-rendered access. Organization reads are tenant-scoped, and authenticated users can create a tenant atomically with their membership, choose an active organization context, manage permitted organization settings/membership lifecycle, archive organizations without destroying commercial history, manage white-label branding where authorized, operate a tenant-scoped customer directory, manage hospitality inventory, configure availability and pricing, and operate the authenticated hospitality booking desk where authorized. The active organization cookie is only a preference: every context read revalidates the authenticated user's active membership server-side.

Fine-grained authorization is implemented through centralized organization capabilities and server-side permission checks. `/dashboard`, `/bookings`, `/customers`, `/inventory`, `/pricing`, `/account`, and `/branding` share the canonical authenticated workspace. Tenant branding is resolved at that server boundary and applied through CSS design tokens rather than tenant-specific component overrides. Customer, inventory, availability, pricing, and booking operations reuse the same authorization, audit, lifecycle, pagination, and tenant-scope boundaries.

Hospitality availability normalizes property/room-type/rate-plan/date/quantity requests, validates active tenant-owned assignments, derives baseline capacity from active physical rooms, applies capacity windows and effective restrictions, and subtracts both active unexpired holds and non-cancelled permanent booking allocations per occupied night. Hold creation and hold-to-booking confirmation use the shared room-type allocation advisory lock. Confirmation creates the permanent allocation and consumes the hold atomically, so capacity cannot reopen between those operations.

Hospitality pricing has a normalized money boundary, persisted nightly base rates, persisted taxes/fees, and persisted add-ons. Base prices, fixed charges, and add-ons are stored in integer minor units with explicit currency, percentage charges use integer basis points, ambiguous overlapping commercial rules are prevented, and server-side quote/revalidation services produce deterministic complete-price fingerprints. Booking confirmation recalculates current complete pricing inside its serializable transaction and persists an immutable accommodation/tax/fee/add-on/total snapshot before confirmation commits. Payments and provider adapters remain incomplete.

## Architectural shape

SF starts as a modular monolith:

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
- hospitality availability: physical capacity, windows, restrictions, temporary holds, expiry semantics, permanent booking allocations, and no-overbooking confirmation locking
- hospitality pricing: normalized money, nightly base rates, taxes/fees, add-ons, complete quotes, and revalidation
- hospitality bookings: idempotent hold conversion, immutable price snapshots, booking/payment states, authenticated booking APIs, and authenticated booking desk
- audit history foundation

Planned commercial/provider modules:

- broad normalized booking search/offer discovery
- booking-specific traveler/passenger structures where product requirements justify them
- remaining business-specific internal inventory
- advanced tenant/provider pricing rules when concrete requirements exist
- payments
- booking modification/cancellation/refund management
- integrations

Business-specific capabilities extend the common booking foundation only where concepts genuinely overlap. Hotel rooms, tours, appointments, and rentals are not forced into one meaningless generic entity. Customer/contact identity is shared, but booking-specific travelers/passengers should be modeled when booking requirements justify their distinct fields and lifecycle.

## Runtime boundaries

- UI components render product state and collect input.
- Route handlers validate and coordinate requests.
- Application services own workflows.
- Domain modules own business rules and state transitions.
- Repository/data-access modules enforce tenant ownership.
- Provider adapters translate normalized operations to external APIs.

Authenticated tenant operations must derive user identity from the validated server session and must revalidate organization membership at the server/data-access boundary. Browser route parameters, form values, or cookies are never sufficient tenant authorization by themselves.

Single-resource tenant operations use both tenant identity and resource identity. Hospitality parent relationships additionally use composite foreign keys so room types, rooms, amenities, images, rate-plan assignments, restrictions, availability records, pricing records, holds, bookings, and allocations cannot cross organization/property boundaries even if application validation is bypassed.

The application shell may display already-resolved user, tenant, role, and branding context, but it is never an authorization boundary. Protected pages and server operations remain responsible for enforcing their own access requirements.

## White-label presentation boundary

White-label settings are organization-owned data, not a client-only theme. The management service requires `organization-settings:manage`, validates canonical values, writes material updates transactionally, and records audit history.

The authenticated shell converts persisted primary/secondary/accent colors and controlled typography into CSS custom properties. Shared components consume those tokens, which prevents scattered tenant-specific hardcoded colors. A configured logo and favicon are also resolved from the active tenant.

A separate public-safe branding reader exposes only values suitable for a future customer-facing booking surface. Persisted public booking copy and a custom-domain hostname are configuration foundations; they do not imply that a booking page, DNS verification, or custom-domain routing has already been implemented.

## Customer boundary

Customer data is tenant-owned operational data. `customer:read` protects directory/detail/history reads and `customer:manage` protects create/edit/archive. Staff and managers can operate the customer directory; customer-role members receive no organization-wide directory access.

Archived customers are preserved rather than deleted. Audit events record lifecycle/activity without duplicating internal notes or credentials into audit JSON.

The current internal hospitality booking desk selects an active tenant customer as the booking customer. That does not replace a future booking-specific traveler/passenger model when a product requires multiple travelers or fields with a different lifecycle.

## Hospitality inventory boundary

Hospitality inventory uses explicit property → room type → room relationships. Amenities remain reusable tenant-owned definitions with explicit property/room-type assignments. Images use explicit property and room-type metadata records rather than a polymorphic media blob. Rate plans are property-owned commercial identities with explicit room-type assignments. Restrictions remain separate date-scoped commercial rules linked to those stable identities.

`inventory:read` protects reads; `inventory:manage` protects writes. Managers can manage inventory, staff have read-only inventory access, and customer-role members have none. Composite database foreign keys reinforce tenant-consistent parent relationships in addition to server-side scoped services.

Rate plans deliberately stop at commercial identity. Restrictions add minimum/maximum stay and closed-to-arrival/departure behavior without storing prices. Pricing, availability allocation, and booking state remain separate concerns even when they reference the same room type/rate plan scope.

Inventory archival is explicit, dependency-aware where relationships must be cleared, and audited. Hosted image management accepts real HTTPS assets; a future direct-upload feature must sit behind a real storage adapter rather than leaking provider APIs into the inventory domain.

## Availability boundary

The normalized availability request shape is provider-independent. Hospitality availability requires active property, room type, and rate-plan assignment within the authenticated organization, counts only active physical rooms, applies active capacity windows/effective restrictions, and subtracts active unexpired holds plus non-cancelled permanent allocations per occupied night.

`availability:read` protects operational reads. Managers/admins have `availability:manage`; staff are read-only and customer-role members have no organization availability access. Hold allocation, physical-capacity changes, and booking confirmation use the same PostgreSQL advisory-lock scope so competing last-unit operations are serialized.

Temporary holds are converted to permanent allocation only by the booking confirmation transaction. The transaction revalidates the tenant-owned active unexpired hold under the shared allocation lock, creates the booking/allocation, marks the hold `CONSUMED`, and commits those changes together. The internal hospitality policy is no overbooking.

## Pricing boundary

Pricing uses exact integer minor units and explicit currency rather than binary floating-point amounts. `pricing:read` protects quotes/configuration reads; `pricing:manage` protects base-rate, tax/fee, and add-on writes. Managers/admins can manage pricing, staff are read-only, and customer-role members have no internal pricing access.

Base rates, charge rules, and add-ons are immutable-in-practice commercial history: changes are represented by archiving old records and creating new date windows. Concurrent writes serialize on commercial scope/code boundaries before overlap validation.

The normalized complete quote composes accommodation, percentage taxes/fees, fixed-per-booking charges, fixed-per-room-night charges, and selected add-ons using exact arithmetic. Complete-price revalidation compares a deterministic fingerprint that includes all applied components. Browser totals are never authoritative.

Booking confirmation re-reads current persisted pricing and recalculates the complete quote inside the same serializable transaction as hold consumption and permanent allocation. A stale fingerprint aborts the transaction before booking, allocation, hold-consumption, or audit writes commit. Successful confirmation persists an immutable exact-money booking snapshot.

## Booking boundary

The provider-independent booking command references a tenant-owned availability hold and active customer, requires a strict organization-scoped idempotency key, carries the expected complete-pricing fingerprint, and includes normalized selected add-ons. The browser never supplies authoritative totals.

Authenticated booking APIs derive the organization from the validated server tenant context and expose real availability, hold, quote, confirmation, and history operations. The authenticated `/bookings` desk coordinates those APIs and reuses the canonical server services rather than reproducing availability or pricing rules in UI code.

Hold and booking request keys are stable across retryable client failures. Confirmation takes both the booking idempotency lock and shared allocation lock, so a lost response can be retried safely while competing requests cannot consume the same final hold twice.

Broad normalized search, booking-specific traveler/passenger capture, payment orchestration, cancellation/modification, and the public white-label customer booking journey are still separate incomplete dependencies.

## Scaling restraint

Do not introduce microservices, queues, or event-driven architecture until a concrete asynchronous or operational requirement justifies them. The modular monolith should preserve clean boundaries so future extraction remains possible.
