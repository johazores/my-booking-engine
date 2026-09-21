# PostgreSQL identifier portability

SF targets PostgreSQL, where identifiers are stored at a maximum of 63 bytes. Long quoted constraint, index, and trigger names are still truncated by PostgreSQL, which can create noisy migrations and can become a deployment blocker when two generated-style names collapse to the same stored identifier.

## Rental evidence cleanup

The `20260922064500-rental-identifier-portability` migration normalizes the remaining known overlong identifiers in the rental money/evidence path without rewriting retained data.

It renames:

- damage and late-return settlement unique indexes;
- post-apply effective-refund unique/index objects;
- manual-reference cross-scope triggers for damage, late return, commercial-amendment settlement, and effective refunds;
- overlong manual-reference registration triggers;
- the prepared-commercial-amendment cancellation trigger.

The migration refers to every legacy object by its exact 63-byte PostgreSQL stored name, so it works after the historical migrations have already been applied as well as on a fresh migration chain. Only object names change; table data and business behavior do not.

The Prisma mappings for damage settlement, late-return settlement, and effective-refund indexes use the final compact physical names so schema drift checks compare against the post-migration database correctly.

## Supplier reservation clean-chain repair

The supplier-reservation migration history had two independent clean-deployment collisions caused by PostgreSQL identifier truncation:

- `hospitality_supplier_reservation_operations_request_fingerprint_version_check` and the earlier `...request_fingerprint_check` collapse to the same 63-byte stored name; and
- the historical provider-reference check, the replacement provider-reference state check, and the provider-reference format check all collapse to the same `hospitality_supplier_reservation_operations_provider_reference_` stored name.

Those collisions occur inside historical migrations before a later repair migration could execute, so the collision-causing statements are corrected in place. The request-fingerprint-version and provider-reference-format checks now use compact explicit names, and the old provider-reference check is dropped before the state replacement is installed.

The later `20260922073000-supplier-reservation-identifier-portability` migration then normalizes the remaining live supplier reservation identifiers. It renames 17 constraints and 6 indexes using their exact PostgreSQL-stored 63-byte names. The migration is rename-only: it does not recreate commercial evidence, mutate reservation state, or weaken tenant scope.

The supplier Prisma fragment maps the explicit operation/attempt foreign-key, unique, and index names that Prisma can model. Tenant-bound relations remain composite across `organizationId` and the resource identifier.

Because the clean-chain blockers required historical migration edits, any environment that has already recorded the previous migration checksums must be reviewed and reconciled intentionally before deployment. Never treat the source contract alone as proof that an already-deployed database is drift-clean.

## Regression protection

`scripts/rental-postgresql-identifier-portability-source-contract.test.mjs` verifies that:

- every legacy rename source is exactly 63 bytes;
- every replacement identifier fits within the PostgreSQL limit;
- replacement names are unique;
- Prisma mapped names fit the same limit and match the final database names;
- trigger renames retain their intended table scope and do not drop or recreate evidence objects.

`scripts/supplier-reservation-postgresql-identifier-portability-source-contract.test.mjs` verifies that:

- the two historical supplier clean-chain collisions are reproduced at the 63-byte boundary and repaired by compact names/order;
- all 23 supplier portability rename sources are exact PostgreSQL-stored identifiers and all destinations are bounded and unique;
- the portability migration is rename-only;
- Prisma uses the final explicit operation/attempt database names; and
- supplier operation/attempt relations keep composite tenant authority.

The live migration gate still requires `npm run test:database` against an explicitly disposable PostgreSQL target before the database checklist can be marked complete. GitHub Actions are not required or used.
