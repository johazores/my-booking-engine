# Public Booking Write Boundary

## Status

SF now has a dedicated customer-safe **server service boundary** for public hospitality availability holds. It reuses the same canonical allocation lock, restriction evaluation, capacity calculation, serializable transaction, and idempotency behavior as staff hold creation without calling a staff permission wrapper or inventing a synthetic user.

The public HTTP write route and primary booking action remain deliberately closed. Before anonymous internet traffic can create capacity holds, SF still needs a deployment-valid abuse-control contract that works across application instances. A process-local limiter or an untrusted forwarded IP would not be sufficient production protection and must not be presented as such.

## Canonical hold transaction

`src/server/availability/hospitality-availability-hold-core.ts` owns provider-independent hold persistence. Both staff and public services call this core inside their own serializable transactions.

Creation:

- acquires the organization/property/room-type allocation advisory lock;
- enforces tenant-owned active room/rate assignment;
- evaluates stay restrictions;
- calculates sellable capacity from physical rooms, availability windows, active unexpired holds, and non-cancelled booking allocations;
- preserves the existing tenant-scoped idempotency contract; and
- returns whether the hold was newly created so caller-specific audit/ownership work can remain atomic and retry-safe.

Release now acquires that same allocation lock before changing an active hold. This serializes release against confirmation for the same inventory boundary and closes the previous release-vs-confirm race for staff and public callers alike.

The authenticated `hospitality-availability-hold-service.ts` remains the staff authorization boundary. It still requires `availability:manage` and writes normal staff `AuditEvent` records. Extracting the core does not weaken staff authorization.

## Durable public principal and ownership

`PublicBookingPrincipal` is a short-lived server-created identity belonging to exactly one organization. It is not a `User`, does not receive organization membership, and never inherits staff permissions.

`PublicBookingHoldOwnership` binds a hold to that principal and organization. PostgreSQL composite foreign keys enforce both sides of the ownership boundary. `PublicBookingAuditEvent` records public actions separately from staff audit rows, preserving truthful actor attribution and avoiding synthetic staff users.

## Public hold creation service

`createPublicHospitalityAvailabilityHold`:

1. resolves an active organization from the public slug server-side;
2. derives the internal hold idempotency key from a browser-generated UUID v4 request key plus the deployment secret and organization ID;
3. creates the hold through the canonical transaction core with a fixed 15-minute public TTL;
4. creates the durable public principal, hold ownership, and secret/PII-minimized public audit event in the **same transaction** when the hold is new;
5. on an exact retry, requires the existing persisted public ownership and reuses that principal instead of duplicating principals or audit events; and
6. returns only customer-safe hold metadata plus a fresh opaque version-2 hold capability. Internal organization, principal, and hold IDs are not returned.

A reused request key with a different allocation payload retains the canonical idempotency conflict behavior. A retry after the original hold has expired or ended fails closed and requires a new public request key.

## Public hold release service

`releasePublicHospitalityAvailabilityHold` resolves the organization by slug, verifies the opaque capability against that tenant, verifies persisted principal/hold ownership, requires the principal to remain active, then releases through the canonical allocation-locked transaction core.

A first successful release writes one public audit event. Exact repeated release calls are idempotent and do not duplicate audit records. A capability presented under another tenant fails before the hold is touched.

## Capability and request secret

`SF_PUBLIC_BOOKING_SECRET` is required for public booking writes and must contain at least 32 bytes of deployment-provided secret material. It is used with domain-separated request HMAC input and as the key material for AES-256-GCM capability encryption. The value must never be committed or exposed to browser code.

The opaque capability remains a bearer credential. Future HTTP routes must keep it out of URLs, logs, analytics, audit payloads, and rendered server HTML. HTTPS is required in production.

## Remaining HTTP abuse boundary

The next step is not another domain or persistence primitive. It is the production ingress policy for anonymous writes. Before exposing hold creation through `/api` and replacing the public page's current contact-to-reserve behavior, SF needs a durable multi-instance control for bounded hold creation and retry handling, with a trusted client/network attribution strategy appropriate to the deployment platform.

Once that policy exists, the HTTP route can call the service implemented here without duplicating inventory logic. Later customer/guest attachment, confirmation, payment collection/recovery, and cancellation must continue verifying both the capability and persisted public ownership.

## Validation coverage

`public-hospitality-hold.integration.ts` is registered in the disposable PostgreSQL harness and covers:

- tenant-derived public creation without a staff actor;
- customer-safe output with opaque capability authorization;
- durable principal/hold ownership;
- separate public audit attribution and absence of a fake staff audit;
- exact idempotent retry without duplicate hold, principal, or audit rows;
- changed-payload idempotency conflict;
- cross-tenant capability rejection;
- allocation-locked release; and
- idempotent repeated release without duplicate audit events.

Existing staff hold integration coverage remains in place and exercises the same canonical core through the staff permission boundary.

Full repository typecheck, lint, Prisma/database validation, integration execution, and production build require the documented Node 24 runtime and disposable PostgreSQL environment. GitHub Actions are intentionally not part of this validation path.
