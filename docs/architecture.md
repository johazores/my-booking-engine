# SF Architecture

## Status

This document describes the target architecture and identifies what exists today. It must not be read as a claim that every module is already implemented.

## Current foundation

SF currently uses a modular Next.js application with PostgreSQL/Prisma persistence. The implemented data foundation contains organizations, users, organization memberships, password credentials, persisted opaque authentication sessions, organization/platform roles, audit events, tenant-owned white-label presentation settings, tenant-owned customer records, hospitality inventory covering properties, room types, physical rooms, amenities, hosted-image metadata, property-owned rate plans with room-type assignments, date/stay/arrival restrictions, availability windows, temporary availability holds, nightly base rates, and persisted hospitality tax/fee rules.

First-party email/password authentication is implemented through server-side App Router flows with secure session cookies and protected server-rendered access. Organization reads are tenant-scoped, and authenticated users can create a tenant atomically with their membership, choose an active organization context, manage permitted organization settings/membership lifecycle, archive organizations without destroying commercial history, manage white-label branding where authorized, operate a tenant-scoped customer directory, manage hospitality inventory, configure availability, and manage hospitality pricing where authorized. The active organization cookie is only a preference: every context read revalidates the authenticated user's active membership server-side.

Fine-grained authorization is implemented through centralized organization capabilities and server-side permission checks. `/dashboard`, `/customers`, `/inventory`, `/pricing`, `/account`, and `/branding` share the canonical authenticated workspace. Tenant branding is resolved at that server boundary and applied through CSS design tokens rather than tenant-specific component overrides. Customer, inventory, availability, and pricing operations reuse the same authorization, audit, lifecycle, pagination, and tenant-scope boundaries.

Hospitality availability normalizes property/room-type/rate-plan/date/quantity requests, validates active tenant-owned assignments, derives baseline capacity from active physical rooms, applies capacity windows and effective restrictions, and subtracts active unexpired holds per occupied night. Hold creation uses a shared allocation advisory lock and serializable transaction for last-unit safety. Permanent booking allocations and atomic booking confirmation remain incomplete.

Hospitality pricing has a normalized money boundary, persisted nightly base rates, and persisted taxes/fees. Base prices and fixed charges are stored in integer minor units with explicit currency, percentage charges use integer basis points, same-code overlapping charge rules are protected against ambiguous double application, and server-side quote/revalidation services produce deterministic complete-price fingerprints. Add-ons, booking price snapshots, payments, and provider adapters remain incomplete.

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
- hospitality availability: physical capacity, windows, restrictions, temporary holds, and expiry semantics
- hospitality pricing: normalized money, nightly base rates, taxes/fees, complete quotes, and revalidation
- audit history foundation

Planned commercial/provider modules:

- permanent booking allocations and atomic confirmation
- remaining business-specific internal inventory
- add-ons and advanced pricing rules
- bookings
- payments
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

Single-resource tenant operations use both tenant identity and resource identity. Hospitality parent relationships additionally use composite foreign keys so room types, rooms, amenities, images, rate-plan assignments, restrictions, availability records, base rates, and charge rules cannot cross organization/property boundaries even if application validation is bypassed.

The application shell may display already-resolved user, tenant, role, and branding context, but it is never an authorization boundary. Protected pages and server operations remain responsible for enforcing their own access requirements.

## White-label presentation boundary

White-label settings are organization-owned data, not a client-only theme. The management service requires `organization-settings:manage`, validates canonical values, writes material updates transactionally, and records audit history.

The authenticated shell converts persisted primary/secondary/accent colors and controlled typography into CSS custom properties. Shared components consume those tokens, which prevents scattered tenant-specific hardcoded colors. A configured logo and favicon are also resolved from the active tenant.

A separate public-safe branding reader exposes only values suitable for a future customer-facing booking surface. Persisted public booking copy and a custom-domain hostname are configuration foundations; they do not imply that a booking page, DNS verification, or custom-domain routing has already been implemented.

## Customer boundary

Customer data is tenant-owned operational data. `customer:read` protects directory/detail/history reads and `customer:manage` protects create/edit/archive. Staff and managers can operate the customer directory; customer-role members receive no organization-wide directory access.

Archived customers are preserved rather than deleted. Audit events record lifecycle/activity without duplicating internal notes or credentials into audit JSON.

## Hospitality inventory boundary

Hospitality inventory uses explicit property → room type → room relationships. Amenities remain reusable tenant-owned definitions with explicit property/room-type assignments. Images use explicit property and room-type metadata records rather than a polymorphic media blob. Rate plans are property-owned commercial identities with explicit room-type assignments. Restrictions remain separate date-scoped commercial rules linked to those stable identities.

`inventory:read` protects reads; `inventory:manage` protects writes. Managers can manage inventory, staff have read-only inventory access, and customer-role members have none. Composite database foreign keys reinforce tenant-consistent parent relationships in addition to server-side scoped services.

Rate plans deliberately stop at commercial identity. Restrictions add minimum/maximum stay and closed-to-arrival/departure behavior without storing prices. Pricing, availability allocation, and booking state remain separate concerns even when they reference the same room type/rate plan scope.

Inventory archival is explicit, dependency-aware where relationships must be cleared, and audited. Hosted image management accepts real HTTPS assets; a future direct-upload feature must sit behind a real storage adapter rather than leaking provider APIs into the inventory domain.

## Availability boundary

The normalized availability request shape is provider-independent. Hospitality availability requires active property, room type, and rate-plan assignment within the authenticated organization, counts only active physical rooms, applies active capacity windows/effective restrictions, and subtracts active unexpired holds per occupied night.

`availability:read` protects operational reads. Managers/admins have `availability:manage`; staff are read-only and customer-role members have no organization availability access. Hold allocation and related physical-capacity changes use the same PostgreSQL advisory-lock scope so competing last-unit operations are serialized.

Temporary holds are not permanent bookings. A future booking confirmation transaction must use the same allocation boundary to convert/consume a valid hold or allocate directly without overbooking.

## Pricing boundary

Pricing uses exact integer minor units and explicit currency rather than binary floating-point amounts. `pricing:read` protects quotes/configuration reads; `pricing:manage` protects base-rate and tax/fee writes. Managers/admins can manage pricing, staff are read-only, and customer-role members have no internal pricing access.

Base rates and charge rules are immutable-in-practice commercial history: changes are represented by archiving old records and creating new date windows. Concurrent base-rate writes are serialized by sellable pricing scope. Charge-rule writes are serialized by tenant/property/scope/code and reject same-code overlap where property-wide and scoped rules could otherwise double-apply one commercial charge.

The normalized complete quote composes accommodation, percentage taxes/fees, fixed-per-booking charges, and fixed-per-room-night charges using exact arithmetic. Price revalidation recalculates current persisted pricing and compares a deterministic fingerprint that includes applied adjustments. Browser totals are never authoritative.

Booking creation must revalidate pricing inside its own commercial transaction and persist a price snapshot before any final confirmation is considered complete.

## Scaling restraint

Do not introduce microservices, queues, or event-driven architecture until a concrete asynchronous or operational requirement justifies them. The modular monolith should preserve clean boundaries so future extraction remains possible.
