# SF Architecture

## Status

This document describes the target architecture and identifies what exists today. It must not be read as a claim that every module is already implemented.

## Current foundation

SF currently uses a modular Next.js application with PostgreSQL/Prisma persistence. The implemented data foundation contains organizations, users, organization memberships, password credentials, and persisted opaque authentication sessions.

First-party email/password authentication is implemented through server-side App Router flows with secure session cookies and protected server-rendered access. Organization reads are tenant-scoped, and authenticated users can now create a tenant atomically with their membership and choose an active organization context. The active organization cookie is only a preference: every context read revalidates the authenticated user's active membership server-side.

Granular roles/permissions, the persistent application shell, booking domain modules, payments, inventory, and provider adapters are not implemented yet.

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

Foundation modules:

- authentication
- organizations
- memberships
- roles and permissions
- tenant settings
- branding
- integrations

Booking domain modules:

- customers/travelers/guests
- internal inventory
- availability
- pricing
- bookings
- payments
- audit history

Business-specific capabilities extend the common booking foundation only where concepts genuinely overlap. Hotel rooms, tours, appointments, and rentals should not be forced into one meaningless generic entity.

## Runtime boundaries

- UI components render product state and collect input.
- Route handlers validate and coordinate requests.
- Application services own workflows.
- Domain modules own business rules and state transitions.
- Repository/data-access modules enforce tenant ownership.
- Provider adapters translate normalized operations to external APIs.

Authenticated tenant operations must derive user identity from the validated server session and must revalidate organization membership at the server/data-access boundary. Browser route parameters, form values, or cookies are never sufficient tenant authorization by themselves.

## Scaling restraint

Do not introduce microservices, queues, or event-driven architecture until a concrete asynchronous or operational requirement justifies them. The modular monolith should preserve clean boundaries so future extraction remains possible.
