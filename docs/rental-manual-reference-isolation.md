# Rental manual provider reference isolation

SF treats a manual/offline provider reference as tenant-wide commercial evidence, not as a value that is unique only inside one rental ledger. The same real-world receipt or refund reference must never identify two different rental money movements in the same organization.

## Covered ledgers

The reference namespace currently covers all manual rental settlement evidence:

- booking-price payments and refunds in `RentalPaymentTransaction`;
- damage-liability collection and refund evidence in `RentalDamageSettlementTransaction`;
- security-bond collection and release evidence in `RentalSecurityBondTransaction`;
- late-return collection and refund evidence in `RentalLateReturnSettlementTransaction`;
- prepared commercial-amendment adjustment and compensation evidence in `RentalBookingCommercialAmendmentSettlementTransaction`;
- post-apply effective refunds in `RentalBookingEffectiveRefundTransaction`.

`sourceProviderReference` is deliberately not globally unique. It points back to retained source money and therefore may legitimately be referenced by more than one bounded refund row. Global identity applies to each new transaction's own `providerReference`.

## Central database registry

`RentalManualProviderReference` is a database-authored identity registry keyed by `(organizationId, providerReference)`. It stores only the source ledger and source row ID needed to prove which retained rental transaction owns that reference. It is not a payment ledger and does not replace any domain settlement evidence.

The migration backfills the registry from all six ledgers and fails closed if historical duplicate tenant references are discovered. The registry is append-only. Direct registry inserts are rejected unless the named source row already exists in the same organization with provider `manual` and the same provider reference.

Every covered ledger keeps the shared `sf:rental-manual-reference:<organization>:<reference>` PostgreSQL advisory lock. The cross-scope `BEFORE INSERT` guard resolves one registry row instead of maintaining an expanding set of table-to-table comparisons. An `AFTER INSERT` trigger then registers the newly committed source row. Because the advisory lock is transaction-scoped, concurrent inserts of the same reference into different ledgers serialize; only the first valid source can own the registry key.

If a source insert fails after registration is attempted, PostgreSQL rolls the registry insert back with the same transaction. If registration conflicts, the source insert is rolled back as well. Provider-specific business evidence remains in the original ledger.

## Application and provider boundary

All six manual rental writers normalize the proposed reference, acquire the same tenant/reference advisory lock, and query `RentalManualProviderReference` before calling `ManualPaymentProvider`. The application therefore fails early from one central cross-ledger authority instead of relying on a service-local list of known settlement tables. Adding another registry-backed rental money ledger cannot silently create a blind spot in an older writer's pre-provider collision check.

The database remains the final authority. A concurrent writer cannot race past the application preflight because it must acquire the same transaction-scoped advisory lock before the registry-backed insert guard and registration trigger run. Application checks provide early, domain-specific conflicts; PostgreSQL independently preserves the tenant-wide identity invariant.

`ManualPaymentProvider` records real-world offline evidence only; it does not move money. A database conflict therefore never converts an SF-side provider call into an untracked external charge or refund. Real external actions must already have happened before staff record the corresponding manual evidence. Keeping collision detection before the adapter also preserves the correct boundary if a future provider implementation gains external side effects.

## Tenant isolation and immutability

The registry key includes `organizationId`, so the same external reference may be used independently by different tenants. A registry row can only be created from a matching tenant-owned source row and cannot be updated or deleted. Business authorization remains enforced by the originating rental write service; the registry is an integrity layer, not an authorization surface.

## Validation

`scripts/rental-manual-reference-isolation-source-contract.test.mjs` protects the six-ledger coverage, shared advisory-lock namespace, registry-backed application preflight, provider-call ordering, registry backfill, append-only source proof, and registration trigger wiring.

The live database gate remains `npm run test:database` against an explicitly disposable PostgreSQL target. Applying the migration to production must fail rather than automatically repair historical duplicate manual references, because choosing which financial evidence is authoritative requires explicit operator review.

GitHub Actions are not required or used for this validation.
