# Commercial amendment orchestration

This document describes the authenticated product boundary that turns a reviewed non-zero hospitality price change into a recoverable commercial amendment. It sits above amendment preparation, provider execution/reconciliation, recovery, and final serializable apply services. It does not replace those domain boundaries and does not let the browser supply money, provider authority, tenant identity, settlement source, or booking truth.

## Product flow

A confirmed booking starts with `POST /api/bookings/hospitality/[booking-id]/modify/preview`. The browser can prepare a non-zero reviewed change only by sending the selected commercial terms plus the exact `adjustmentFingerprint` returned by that server review to:

`POST /api/bookings/hospitality/[booking-id]/commercial-amendments`

Preparation requires both `booking:manage` and `payment:manage`. The server revalidates the tenant-owned booking, persisted booking version, authoritative settlement, pricing, restrictions, occupancy, and target inventory before creating the amendment. Any required target inventory protection is held by the existing amendment preparation service. Preparing an amendment does not move money and does not modify the booking's commercial or payment snapshot.

The booking detail layout discovers at most one unexpired `PREPARED` amendment for the active organization and renders the server-derived orchestration state above the booking record. The commercial-edit form also checks for an active amendment and disables competing edits while one exists. Users without `payment:manage` can still use the zero-delta commercial flow, but the UI does not offer a price-adjustment preparation action to them.

## Server-derived transport states

`deriveHospitalityCommercialAmendmentTransportState` maps the provider-neutral execution decision to product states without inventing provider truth:

- `MANUAL_SETTLEMENT_REQUIRED` — staff must complete the exact external payment or refund outside SF and then record the real external reference.
- `STRIPE_REFUND_REQUIRED` — SF can execute the next exact server-selected source-scoped Stripe refund.
- `STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED` — a Stripe price increase can start/resume the customer-authorized hosted Checkout flow; amount, currency, tenant, amendment, and operation identity remain server-derived.
- `WAIT_FOR_PROVIDER` — an amendment-owned provider operation is unresolved and must converge before another money action.
- `READY_TO_APPLY` — authoritative amendment settlement matches the prepared target total.
- `RECOVERY_REQUIRED`, `EXPIRED`, `APPLIED`, `CANCELLED`, and `CONFLICT` preserve lifecycle/recovery truth and do not create unsafe money-moving browser actions.

`hospitality-booking-commercial-amendment-transport-service.ts` derives this state from one tenant-owned amendment and the complete tenant-owned payment ledger. Refund source selection comes from authoritative settlement reconciliation and `deriveNextBookingRefundSource`; the browser never chooses a source or amount. Stripe settlement source references are not exposed through the product transport; manual refund source references are shown only because staff must perform that exact external refund before recording it in SF.

## Authenticated API boundary

All write routes use the existing authenticated same-origin booking context. The transport services independently require both `booking:manage` and `payment:manage` and scope amendment and payment reads by organization plus booking.

- `GET /api/bookings/hospitality/[booking-id]/commercial-amendments` discovers the current unexpired prepared amendment for resumable UI.
- `POST /api/bookings/hospitality/[booking-id]/commercial-amendments` prepares the reviewed price-changing amendment.
- `GET /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]` refreshes authoritative orchestration state.
- `POST .../[amendment-id]/manual-settlement` records a real external manual payment/refund reference through the existing manual amendment executor.
- `POST .../[amendment-id]/stripe-refund` executes the next exact source-scoped Stripe refund through the amendment-owned Stripe refund service.
- `POST .../[amendment-id]/stripe-refund/status` performs exact retry/provider reconciliation for the one unresolved amendment-owned Stripe refund.
- `POST .../[amendment-id]/stripe-checkout` creates or resumes the one customer-authorized Stripe Checkout attempt for a normal additional charge.
- `POST .../[amendment-id]/stripe-checkout/status` reconciles the exact persisted Checkout Session with Stripe provider truth.
- `POST .../[amendment-id]/apply` invokes the existing final serializable apply boundary only after settlement proves `READY_TO_APPLY`.
- `POST .../[amendment-id]/cancel` invokes the existing guarded cancellation boundary. The UI offers cancellation only before adjustment money has settled and the service revalidates that rule server-side.

These routes do not accept organization IDs, money amounts, currencies, payment providers, settlement references, or refund sources from the browser. Manual references identify real external operations. Stripe Checkout attempt identity is derived server-side from the amendment's definitive failed-attempt count, so the browser cannot create a new financial idempotency namespace.

## Manual settlement behavior

The manual provider remains a recording adapter, not a money mover. For an additional charge, staff must receive the exact displayed amount externally before entering the real payment reference. For a refund, the panel displays the exact server-selected settlement source and amount; staff must complete that refund externally before recording the real refund reference.

A large manual refund can span multiple settlement sources. Each successful source-scoped record returns fresh transport state. If another source remains, the UI requires a new real external refund reference and a new idempotent operation. The final booking snapshot is unchanged until `READY_TO_APPLY` is revalidated and applied.

## Stripe refund behavior

A Stripe refund button appears only when the provider-neutral execution decision says the exact next operation is a Stripe refund. The existing Stripe amendment refund executor re-derives source, amount, currency, booking version, amendment state, and ledger truth under locks before crossing the provider boundary.

If Stripe returns non-final or transport-ambiguous state, the amendment remains `WAIT_FOR_PROVIDER`. The status action either retries the exact persisted internal claim with its original idempotency identity or reconciles the exact persisted Stripe refund reference. It cannot select another source or start a second unrelated refund while provider truth is unresolved.

## Stripe price increases

`STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED` now has a real Stripe-hosted Checkout action rather than a dead placeholder. SF derives the exact remaining additional charge from the amendment ledger, creates an amendment-attributed `CAPTURE / AMBIGUOUS` claim under booking/payment/idempotency locks, and passes only authoritative money/ownership metadata and server return URLs to the Stripe adapter.

The customer enters card/payment details only on Stripe. SF does not reuse historical card credentials, expose a PaymentMethod input in the booking workspace, or treat browser return navigation as payment truth. A bound Checkout Session is resumed with the same deterministic provider idempotency identity until it reaches a definitive provider state.

Polling through `stripe-checkout/status` and signed `checkout.session.completed` / `checkout.session.expired` callbacks validate exact tenant, booking, amendment, purpose, Session, currency, amount, and PaymentIntent identity before changing only amendment-owned payment evidence. Generic booking payment finalizers cannot mutate the booking from these amendment claims.

The Stripe-hosted Session can remain open beyond the prepared amendment/inventory-protection window. If payment arrives after amendment expiry, SF records the real settlement evidence but does not apply stale booking terms. The expired-amendment recovery domain then owns compensation, including a server-selected refund from adjustment-created settlement money. An unpaid expired Checkout becomes a definitive failed attempt and can stop blocking expiry once no other payment evidence requires recovery.

## Final apply and expiry

Only `applyHospitalityBookingCommercialAmendment` can rewrite booking commercial terms, immutable price components, allocation, and denormalized payment status. It revalidates booking version, target hold, target inventory, restrictions, pricing, adjustment identity, and complete amendment settlement inside a serializable transaction.

If an amendment expires before money moves, cancellation/expiry can safely release target protection. If amendment-attributed money or unresolved provider evidence exists, normal orchestration stops and the existing commercial-amendment recovery boundary owns reconciliation/compensation. Browser redirects, local component state, and clock expiry are never payment truth.

A provider success does not weaken lifecycle authority. Settlement that completes while the amendment is still valid can advance to `READY_TO_APPLY`; settlement that becomes authoritative after expiry is recovery evidence, not permission to commit stale inventory or price terms.

A known booking, price, or inventory conflict can still occur after the exact amendment delta has settled but before the final serializable booking mutation commits. The apply transport now handles that boundary explicitly. After the failed apply transaction rolls back, a separate tenant-scoped serializable routing transaction re-reads the complete booking payment ledger. It surrenders the amendment's remaining apply window only when settlement independently re-derives as `READY_TO_APPLY`; unresolved or conflicting payment evidence never triggers compensation routing.

For a fully settled failed apply, SF moves the still-`PREPARED` amendment into the existing recovery lifecycle by shortening `expiresAt` to the current time without ever extending an older expiry, releasing any remaining target hold, and recording audit evidence. Booking commercial/payment state and provider evidence remain unchanged. The existing expired-amendment recovery service then owns compensation or operator reconciliation, and booking/payment mutation guards remain blocking until settlement is restored and the amendment is safely terminalized.

## Validation

Dependency-free orchestration coverage includes manual execution, Stripe refund execution, customer-authorized Stripe Checkout identity/reconciliation, provider waiting, ready-to-apply, recovery, expiry, terminal states, conflicts, and post-settlement apply-failure routing. Checkout webhook-domain coverage verifies normal amendment ownership is distinct from recovery and normal booking Checkout events.

Full repository typecheck/lint/test/build, Prisma validation/migrations, PostgreSQL integration/concurrency tests, and real provider operational validation remain mandatory before production release. They must run in the repository-required Node 24 environment with an explicitly disposable PostgreSQL target. GitHub Actions are not used.
