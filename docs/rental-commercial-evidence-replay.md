# Rental commercial evidence replay after terminal lifecycle changes

SF treats retained manual/offline commercial rows as immutable evidence. Exact idempotent retries must continue to verify and return that evidence even when the parent rental workflow has legitimately moved to a later lifecycle state.

## Commercial amendment adjustment and compensation

A commercial amendment adjustment is recorded while the amendment is `PREPARED`, but the same retained adjustment becomes historical input after the amendment is later `APPLIED`. An exact retry using the same amendment and manual reference therefore resolves the retained adjustment before fresh `PREPARED`/expiry authority is evaluated.

Compensation is also historical evidence. After compensation, the amendment may be cancelled or expire. An exact compensation retry resolves the retained compensation before requiring fresh `PREPARED` authority.

Only exact retained evidence receives this treatment. A different reference or a genuinely new settlement attempt still must satisfy the live amendment status, expiry, inventory/readiness, source, and settlement-state rules before any provider adapter call.

## Post-apply effective refunds

A post-apply effective refund can reduce the combined effective settlement to zero and then allow the rental booking to be cancelled. The already-retained refund must remain replayable after that cancellation.

`recordRentalBookingPostApplyManualRefund` therefore validates the applied-amendment/effective-settlement evidence, derives the deterministic request identity, and resolves an exact retained refund before applying the fresh `CONFIRMED` booking requirement. A new refund on a cancelled booking remains rejected.

## Safety properties

All replay decisions remain inside the existing serializable tenant/booking or tenant/amendment locks. Tenant ownership, permissions, deterministic idempotency, request fingerprints, immutable amounts/currency, retained provider references, and bounded reconciliation are unchanged.

This change does not create new money movement. `ManualPaymentProvider` remains evidence-only for transactions that already happened outside SF, and no new provider call occurs during an idempotent replay.

No schema or migration change is required because the retained rows and database lifecycle guards are already durable; this change corrects application ordering so later valid lifecycle transitions do not erase historical idempotency.

## Validation

`scripts/rental-commercial-evidence-replay-source-contract.test.mjs` protects replay-before-fresh-authority ordering for amendment adjustments, amendment compensation, and post-apply effective refunds.

Full repository validation remains `npm run validate` under the Node version declared by `package.json`. Live database coverage remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
