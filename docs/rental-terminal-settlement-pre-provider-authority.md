# Rental terminal settlement pre-provider authority

SF treats security-bond disposition and customer-damage settlement as mutually exclusive commercial authority. The database already serializes these terminal decisions; the application now takes the same advisory locks before invoking the manual payment adapter for a fresh conflicting operation.

## Security-bond release versus forfeiture

A fresh manual security-bond release acquires `sf:rental-security-bond-disposition:{organizationId}:{bondId}` after the booking and request-idempotency locks. While holding that lock, the service reloads the retained bond state and checks for `RentalSecurityBondForfeiture` before any manual refund adapter call.

If forfeiture already exists, release fails as a normal conflict without invoking the adapter. If a direct database forfeiture is racing the application, both paths serialize on the same disposition lock. PostgreSQL keeps the final trigger backstop that rejects release after forfeiture and forfeiture after release.

This does not change the deliberate unwind rule for ordinary collected bonds: a real release can still be recorded after the pickup window closes or custody begins. The only new rejection is a terminal disposition that is already forfeited.

Exact idempotent release replay remains evidence verification. The disposition lock is acquired before the fresh-state reload and replay lookup so a concurrent direct write cannot turn a fresh release into adapter work against stale settlement state.

## Damage payment versus bond forfeiture

A fresh manual customer-damage payment acquires the existing physical-unit lock, its deterministic request-idempotency lock, and then `sf:rental-damage-liability-settlement:{organizationId}:{liabilityDecisionId}`. That last key is the same lock used by the PostgreSQL bond-forfeiture and damage-settlement mutual-exclusion trigger.

After the lock is held, the service resolves exact idempotent replay first. A genuinely new payment then checks whether the liability is already settled by `RentalSecurityBondForfeiture`. If so, it fails before manual-reference reservation and before `ManualPaymentProvider.recordOfflinePayment`.

Damage refunds also take the liability-settlement lock before reading current payment/refund state and before invoking the refund adapter. A valid retained damage payment already prevents bond forfeiture, but using the same terminal-settlement lock keeps the application writer aligned with the database serialization boundary.

## Authority and recovery

All reads remain tenant-scoped by `organizationId` plus retained booking, bond, or liability identity. Browser input still cannot choose tenant identity, bond/liability linkage, amount, currency, provider, or lock identity.

The current manual adapter records evidence for money moved outside SF; it does not itself charge or refund a card. Even so, invalid terminal authority is rejected before adapter invocation so the same service ordering remains safe when provider-backed settlement is introduced behind the existing adapter boundary.

No schema change or new migration is required. `20260917060000_rental_security_bond_forfeiture` already owns the durable disposition/liability locks and direct-write rejection rules; this hardening aligns application preflight with that existing PostgreSQL authority.

## Validation

`scripts/rental-terminal-settlement-pre-provider-authority-source-contract.test.mjs` protects lock-key parity, post-lock state refresh, idempotent replay ordering, pre-adapter forfeiture checks, and the existing PostgreSQL backstops.

Full repository validation remains `npm run validate` under the Node version declared by `package.json`. Live concurrency validation remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
