# SF Architecture

## Status

This document describes the target architecture and identifies what exists today. It must not be read as a claim that every module is already implemented.

## Current foundation

SF currently uses a modular Next.js application with PostgreSQL/Prisma persistence. The implemented data foundation contains organizations, users, organization memberships, password credentials, persisted opaque authentication sessions, organization/platform roles, audit events, and tenant-owned white-label presentation settings.

First-party email/password authentication is implemented through server-side App Router flows with secure session cookies and protected server-rendered access. Organization reads are tenant-scoped, and authenticated users can create a tenant atomically with their membership, choose an active organization context, manage permitted organization settings/membership lifecycle, archive organizations without destroying commercial history, and manage white-label branding where authorized. The active organization cookie is only a preference: every context read revalidates the authenticated user's active membership server-side.

Fine-grained authorization is implemented through centralized organization capabilities and server-side permission checks. `/dashboard`, `/account`, and `/branding` share the canonical authenticated workspace. Tenant branding is resolved at that server boundary and applied through CSS design tokens rather than tenant-specific component overrides. Booking domain modules, payments, inventory, and provider adapters are not implemented yet.

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

The core application must never become directly coupled to Amadeus, Sabre, Travelport, Stripe, PayPal, SMTP, SMS providers, or other vendors.

## Modules

Implemented foundation modules:

- authentication
- organizations
- memberships
- roles and permissions
- tenant settings
- branding
- audit history foundation

Planned provider/commercial modules:

- customers/travelers/guests
- internal inventory
- availability
- pricing
- bookings
- payments
- integrations

Business-specific capabilities extend the common booking foundation only where concepts genuinely overlap. Hotel rooms, tours, appointments, and rentals should not be forced into one meaningless generic entity.

## Runtime boundaries

- UI components render product state and collect input.
- Route handlers validate and coordinate requests.
- Application services own workflows.
- Domain modules own business rules and state transitions.
- Repository/data-access modules enforce tenant ownership.
- Provider adapters translate normalized operations to external APIs.

Authenticated tenant operations must derive user identity from the validated server session and must revalidate organization membership at the server/data-access boundary. Browser route parameters, form values, or cookies are never sufficient tenant authorization by themselves.

The application shell may display already-resolved user, tenant, role, and branding context, but it is never an authorization boundary. Protected pages and server operations remain responsible for enforcing their own access requirements.

## White-label presentation boundary

White-label settings are organization-owned data, not a client-only theme. The management service requires `organization-settings:manage`, validates canonical values, writes material updates transactionally, and records audit history.

The authenticated shell converts persisted primary/secondary/accent colors and controlled typography into CSS custom properties. Shared components consume those tokens, which prevents scattered tenant-specific hardcoded colors. A configured logo and favicon are also resolved from the active tenant.

A separate public-safe branding reader exposes only values suitable for a future customer-facing booking surface. Persisted public booking copy and a custom-domain hostname are configuration foundations; they do not imply that a booking page, DNS verification, or custom-domain routing has already been implemented.

## Scaling restraint

Do not introduce microservices, queues, or event-driven architecture until a concrete asynchronous or operational requirement justifies them. The modular monolith should preserve clean boundaries so future extraction remains possible.
