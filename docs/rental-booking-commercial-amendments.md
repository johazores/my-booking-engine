# Rental booking commercial amendments

SF has server-only preparation, manual/offline settlement, compensation, final apply, effective settlement, and post-apply refund foundations for a same-unit rental date change whose fresh target price differs from the current effective total in the same currency. Durable amendment evidence remains separate from the immutable original booking-price ledger.

The product still does not expose the end-to-end commercial amendment workflow as primary staff actions. The backend contracts are intentionally ahead of the product surface so incomplete money orchestration is not presented as complete.

## Reviewed authority and preparation

`reviewRentalBookingRescheduleAuthority` derives server evidence for a same-currency price change. `prepareRentalBookingCommercialAmendment` re-locks and revalidates tenant scope, lifecycle, effective assignment, custody, inventory, pricing, reviewed fingerprints, and fully paid original booking settlement before retaining a short-lived `PREPARED` amendment.

Preparation does not move booking dates or money.

## Settlement, compensation, and final apply

[rental-booking-commercial-amendment-settlement.md](./rental-booking-commercial-amendment-settlement.md) documents the dedicated append-only adjustment ledger. Increases retain an exact manual payment; decreases retain an exact source-attributed manual refund. Compensation reverses real adjustment money when final apply authority is lost.

[rental-booking-commercial-amendment-apply.md](./rental-booking-commercial-amendment-apply.md) documents final apply. The writer revalidates the prepared commercial authority, appends exact reschedule evidence, moves only the effective allocation dates, versions the booking, and terminally links the amendment as `APPLIED`.

The original `RentalBooking` money snapshot remains immutable.

## Effective post-apply settlement and refunds

[rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) is the combined post-apply authority.

For an increase, effective settlement includes the original booking ledger plus the applied adjustment payment. Post-apply refund authority unwinds the amendment charge first and then original booking-price sources.

For a decrease, the applied adjustment is already a source-attributed refund against the original booking-price ledger. Later post-apply refunds cannot reuse that consumed source value.

`recordRentalBookingPostApplyManualRefund` now provides the protected backend write contract. It does not accept a client-selected source. Source ledger/reference and allowed amount are derived from current effective settlement under the shared booking lock. Durable rows retain deterministic idempotency/request fingerprints and are re-read into effective settlement immediately after write.

PostgreSQL independently caps each refund source and extends the tenant-wide manual reference namespace to this ledger.

## Current one-amendment boundary

Only one applied price-changing amendment per rental is supported. Direct post-apply booking-price settlement writes, another reschedule, and another commercial amendment remain blocked so older logic cannot bypass the effective-settlement boundary.

Post-apply booking cancellation is also still blocked. The next dependency is to make cancellation use the same combined effective settlement in the service and PostgreSQL, allowing terminal cancellation only at exact zero effective net.

Authenticated staff orchestration follows that safety boundary. Provider-backed/online adjustment and refund execution remains later scope behind provider adapters.

## Product surface

No primary staff action exposes preparation, adjustment settlement, compensation, final apply, or post-apply refund recording yet. The existing reschedule UI may show exact commercial impact but does not expose a dead money-moving action.

## Validation

- Domain/source-contract tests protect preparation, settlement, final apply, effective settlement, and post-apply refund authority.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
