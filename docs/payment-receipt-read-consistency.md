# Payment receipt read consistency

## Scope

SF payment receipts and the adjacent public Stripe recovery projection are read-only presentation boundaries over persisted booking and payment evidence. They do not create settlement authority, alter provider state, or replace the stricter write/reconciliation contracts.

This boundary keeps three related reads coherent:

- authenticated staff payment receipts;
- capability-owned public payment receipts; and
- capability-owned public Stripe payment/recovery status.

## Customer authority ordering

A valid encrypted public booking capability is necessary but is not the complete persisted authorization boundary. Public receipt and payment-status services first resolve the tenant from the organization slug and verify the tenant-bound capability. Inside the database snapshot they then prove the exact `(organizationId, bookingId)` `PublicBookingBookingOwnership` record belongs to the capability principal and that the matching tenant-scoped `PublicBookingPrincipal` is still unexpired.

Only after those persisted checks succeed may the public receipt service read the tenant-owned booking and successful payment history. The public Stripe status service applies the same ordering before reading the booking, latest Stripe authorization/capture evidence, or an open Checkout session. A valid capability therefore cannot be used to trigger protected booking/payment evidence reads after persisted customer ownership or principal authority has disappeared.

Stripe Checkout creation follows the same persisted-authority-before-protected-read rule. After capability verification, it proves booking ownership plus the unexpired public principal inside one `RepeatableRead` snapshot before reading protected booking state or same-key prior payment evidence. Its later serializable payment-claim boundary reacquires the booking/idempotency locks, takes a fresh production clock observation, revalidates ownership, persisted-principal freshness, and signed-capability expiry, and only then reads protected payment/booking claim state before any Stripe provider call.

## Snapshot consistency

Authenticated receipt generation performs `payment:read` authorization first, then reads active organization presentation, the tenant-owned booking, and the complete bounded successful payment history inside one PostgreSQL `RepeatableRead` transaction.

Public receipt generation performs persisted ownership/principal authorization, booking retrieval, and the complete bounded successful payment history inside one `RepeatableRead` transaction. This prevents the rendered booking payment state and settlement rows from being assembled from unrelated database snapshots during concurrent webhook, reconciliation, or refund activity.

Public Stripe recovery similarly reads persisted public authority, booking state, latest Stripe authorization/capture state, and the current open Checkout session inside one `RepeatableRead` transaction. The customer-safe recovery decision is then derived from that single snapshot.

These are read-consistency guarantees only. They do not replace serializable/advisory-lock write authority in payment, booking, webhook, refund, or Checkout mutation workflows.

## Regression coverage

`scripts/payment-receipt-snapshot-authority-contract.test.mjs` protects the `RepeatableRead` boundaries and persisted public-authority ordering for staff receipts, public receipts, and public Stripe recovery.

The dependency-free source contract can run without a database. Full TypeScript, Prisma, production build, and database-backed validation still require the repository Node 24 toolchain and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
