# Supplier reservation input authority

## Purpose

Supplier reservation operations are tenant-owned commercial write state. Their server services receive JavaScript objects from higher-level coordinators and then cross asynchronous permission checks, provider revalidation, database locks, durable state transitions, and external provider calls.

A caller-owned getter, proxy, nested object, or array must not be able to return one organization or resource before an `await` and a different value afterward. In particular, SF must never authorize tenant A and later persist or query tenant B because the same mutable runtime object was read again after authorization.

`hospitality-supplier-reservation-input-authority.ts` closes that runtime authority gap by materializing each supported reservation input into a small frozen allowlisted snapshot before authorization or any durable/provider work begins.

## Covered boundaries

The shared materializer protects the connected reservation lifecycle boundaries that previously accepted caller-owned objects directly:

- reservation preparation and exact-idempotency authority;
- create submission claim;
- create settlement, with branch-specific `CONFIRMED`, `FAILED`, and `AMBIGUOUS` evidence;
- known-locator reconciliation claim and settlement;
- definitive create review-required settlement;
- one-time accepted-review consumption into a marked create attempt;
- read-only reservation authority review;
- preparation with primary-traveler authority;
- review-and-claim submission authority;
- Travelport commercial-review acceptance and accepted-review revalidation;
- Travelport initial Create orchestration;
- Travelport one-time reviewed Create orchestration; and
- Travelport Booking.com Sync orchestration.

The previously hardened provider-request marker, stale-attempt recovery, recovery-evidence, recovery-write, reconciliation-provider, and low-level Travelport provider-I/O boundaries keep their existing specialized materializers.

## Stable tenant and commercial authority

Each boundary copies its organization, actor, integration/reservation/attempt identifiers, and relevant commercial inputs before the first permission, provider, or database await. Later authorization, provider work, failure settlement, and persistence therefore operate on the same stable tenant authority.

Selection child ages are copied into a frozen array. Primary-traveler identity is copied together with a frozen telephone object. Settlement outcomes are branch-specific so a failed outcome does not accidentally evaluate confirmation-only getters, and vice versa. Reconciliation `NOT_FOUND` keeps the optional supplier-confirmation evidence required by the existing confirmation-continuity rule.

Throwing accessors, revoked proxies, malformed structural objects, unsupported settlement states, and non-boolean failed-outcome retry flags fail through one fixed `HospitalitySupplierReservationConflictError`. Caller-controlled exception text is not rethrown.

## Authorization and tenant isolation

Materialization is not authorization. The existing services continue to:

- validate UUID identifiers;
- require server-side `booking:manage`, plus the existing availability/pricing permissions where commercial revalidation requires them;
- read operations with both reservation ID and organization ID;
- use organization-scoped advisory locks and serializable transactions where required;
- repeat `organizationId` in mutable operation/attempt write predicates; and
- revalidate integration provider, credential version, active status, and `reservation` capability at the existing boundaries.

The materializer only guarantees that these checks and later uses see the same runtime values.

## Provider boundary

Provider-specific semantics remain behind the existing Travelport adapters, executors, and coordinators. This runtime snapshot layer does not interpret supplier payloads, change Travelport endpoint behavior, or weaken the separate SearchComplete, Rules, Availability, payment-authority, Create, Sync, or Retrieve guards.

The initial Create, reviewed Create, and Sync coordinators now snapshot their organization, actor, reservation, and traveler/accepted-review authority before their first asynchronous operation, so later card acquisition, provider-request marking, observability, recovery evidence, and settlement cannot drift to a different caller-provided identity.

## Privacy

The snapshots contain only the non-secret fields already required by the existing reservation workflows. They are in-memory execution authority and add no new persistence or audit payloads.

Raw provider bodies, credentials, access tokens, PAN/CVV, cardholder secrets, payment-card material, or additional traveler/customer data are not introduced into the reservation ledger, audit events, logs, or fingerprints by this change.

## Validation

Focused behavior coverage verifies one-read tenant identity, child-age array freezing, nested traveler telephone freezing, branch-specific settlement access, `NOT_FOUND` supplier-confirmation continuity, strict retryable runtime typing, and sanitized failures for throwing getters and revoked proxies.

A dependency-free source contract verifies that the durable ledger, review settlement/consumption, authority review, Travelport commercial acceptance, accepted-review revalidation, initial Create, reviewed Create, and Sync all materialize caller input before permission, commercial, or provider work.

Full repository Node 24 / TypeScript 6 validation, Prisma/PostgreSQL verification, production build, and live Travelport behavior remain environment gates when those dependencies are available. No GitHub Actions are used for validation.

## Activation boundary

Travelport `reservation` remains deliberately disabled. Runtime input hardening does not satisfy the remaining activation dependencies: a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less correlation and retry semantics.

Related documentation:

- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-tenant-write-scope.md`
- `docs/supplier-reservation-recovery-input-authority.md`
- `docs/supplier-reservation-reconciliation-authority.md`
