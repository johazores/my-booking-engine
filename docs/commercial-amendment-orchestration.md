# Commercial amendment orchestration

This document describes the authenticated product boundary that turns a reviewed non-zero hospitality price change into a recoverable commercial amendment. It sits above the existing amendment preparation, provider execution/reconciliation, recovery, and final serializable apply services. It does not replace those domain boundaries and does not let the browser supply money, provider authority, tenant identity, settlement source, or booking truth.

## Product flow

A confirmed booking still starts with `POST /api/bookings/hospitality/[booking-id]/modify/preview`. The browser can prepare a non-zero reviewed change only by sending the selected commercial terms plus the exact `adjustmentFingerprint` returned by that server review to:

`POST /api/bookings/hospitality/[booking-id]/commercial-amendments`

Preparation requires both `booking:manage` and `payment:manage`. The server revalidates the tenant-owned booking, persisted booking version, authoritative settlement, pricing, restrictions, occupancy, and target inventory before creating the amendment. Any required target inventory protection is held by the existing amendment preparation service. Preparing an amendment does not move money and does not modify the booking's commercial or payment snapshot.

The booking detail layout discovers at most one unexpired `PREPARED` amendment for the active organization and renders the server-derived orchestration state above the booking record. The commercial-edit form also checks for an active amendment and disables competing edits while one exists. Users without `payment:manage` can still use the zero-delta commercial flow, but the UI does not offer a price-adjustment preparation action to them.

## Server-derived transport states

`deriveHospitalityCommercialAmendmentTransportState` maps the provider-neutral execution decision to product states without inventing provider truth:

- `MANUAL_SETTLEMENT_REQUIRED` — staff must complete the exact external payment or refund outside SF and then record the real external reference.
- `STRIPE_REFUND_REQUIRED` — SF can execute the next exact server-selected source-scoped Stripe refund.
- `STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED` — a Stripe price increase needs fresh customer authorization; the normal amendment Checkout transport is not yet exposed.
- `WAIT_FOR_PROVIDER` — an amendment-owned provider operation is unresolved and must converge before another money action.
- `READY_TO_APPLY` — authoritative amendment settlement matches the prepared target total.
- `RECOVERY_REQUIRED`, `EXPIRED`, `APPLIED`, `CANCELLED`, and `CONFLICT` preserve lifecycle/recovery truth and do not create money-moving browser actions.

`hospitality-booking-commercial-amendment-transport-service.ts` derives this state from one tenant-owned amendment and the complete tenant-owned payment ledger. Refund source selection comes from authoritative settlement reconciliation and `deriveNextBookingRefundSource`; the browser never chooses a source or amount. Stripe settlement source references are not exposed through the product transport; manual refund source references are shown only because staff must perform that exact external refund before recording it in SF.

## Authenticated API boundary

All write routes use the existing authenticated same-origin booking context. The transport service independently requires both `booking:manage` and `payment:manage` and scopes amendment and payment reads by organization plus booking.

- `GET /api/bookings/hospitality/[booking-id]/commercial-amendments` discovers the current unexpired prepared amendment for resumable UI.
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments` prepares the reviewed price-changing amendment.
- `GET /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]` refreshes authoritative orchestration state.
- `POST .../[amendment-id]/manual-settlement` records a real external manual payment/refund reference through the existing manual amendment executor.
- `POST .../[amendment-id]/stripe-refund` executes the next exact source-scoped Stripe refund through the amendment-owned Stripe refund service.
- `POST .../[amendment-id]/stripe-refund/status` performs exact retry/provider reconciliation for the one unresolved amendment-owned Stripe refund.
- `POST .../[amendment-id]/apply` invokes the existing final serializable apply boundary only after settlement proves `READY_TO_APPLY`.
- `POST .../[amendment-id]/cancel` invokes the existing guarded cancellation boundary. The UI offers cancellation only before adjustment money has settled and the service revalidates that rule server-side.

These routes do not accept organization IDs, money amounts, currencies, payment providers, settlement references, or refund sources from the browser. Idempotency keys identify user-initiated attempts; all financial authority is re-derived under the existing booking/payment locks.

## Manual settlement behavior

The manual provider remains a recording adapter, not a money mover. For an additional charge, staff must receive the exact displayed amount externally before entering the real payment reference. For a refund, the panel displays the exact server-selected settlement source and amount; staff must complete that refund externally before recording the real refund reference.

A large manual refund can span multiple settlement sources. Each successful source-scoped record returns fresh transport state. If another source remains, the UI requires a new real external refund reference and a new idempotent operation. The final booking snapshot is unchanged until `READY_TO_APPLY` is revalidated and applied.

## Stripe refund behavior

A Stripe refund button appears only when the provider-neutral execution decision says the exact next operation is a Stripe refund. The existing Stripe amendment refund executor re-derives source, amount, currency, booking version, amendment state, and ledger truth under locks before crossing the provider boundary.

If Stripe returns non-final or transport-ambiguous state, the amendment remains `WAIT_FOR_PROVIDER`. The status action either retries the exact persisted internal claim with its original idempotency identity or reconciles the exact persisted Stripe refund reference. It cannot select another source or start a second unrelated refund while provider truth is unresolved.

## Stripe price increases

Normal Stripe additional-charge infrastructure already has amendment-owned authorization/capture, polling, and signed webhook convergence, but the booking UI still does not collect or reuse card credentials. `STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED` is therefore an explicit safe boundary, not a fake payment action. The prepared amendment can be cancelled while no adjustment money has settled.

The next dependency for the normal online price-increase journey is a customer-authorized Stripe-hosted collection transport that creates/resumes one deterministic amendment payment attempt and converges through polling/signed webhook evidence before final apply. The existing expired-amendment recovery Checkout is a recovery-specific flow and must not be reused as normal amendment authority without the normal lifecycle contract.

## Final apply and expiry

Only the existing `applyHospitalityBookingCommercialAmendment` service can rewrite booking commercial terms, immutable price components, allocation, and denormalized payment status. It revalidates booking version, target hold, target inventory, restrictions, pricing, adjustment identity, and complete amendment settlement inside a serializable transaction.

If an amendment expires before money moves, cancellation/expiry can safely release target protection. If amendment-attributed money or unresolved provider evidence exists, the normal orchestration must stop and the existing commercial-amendment recovery boundary owns reconciliation/compensation. Browser redirects, local component state, and clock expiry are never payment truth.

## Validation

The dependency-free transport-state suite covers manual execution, Stripe refund execution, the intentionally closed Stripe customer-authorization state, provider waiting, ready-to-apply, recovery, expiry, terminal states, and conflicts. Full repository typecheck/lint/build, Prisma validation/migrations, and PostgreSQL integration/concurrency tests remain mandatory before production release and must be run only in a supported Node 24 environment with an explicitly disposable PostgreSQL target.
