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

## Hospitality commercial-amendment cleanup

The original hospitality commercial-amendment migration creates three names that exceed PostgreSQL's 63-byte identifier limit:

- the current-room-type foreign key;
- the current-rate-plan foreign key; and
- the organization/booking/status/expiry lookup index.

PostgreSQL stores those objects under truncated 63-byte names while the Prisma fragment previously mapped the longer source spellings. That mismatch is not a data-integrity failure, but it is unnecessary physical-schema drift risk and makes later migrations harder to reason about.

The `20260922081500-hospitality-commercial-amendment-identifier-portability` migration renames those exact stored identifiers to compact permanent names. It is rename-only: it does not drop or recreate foreign keys/indexes, rewrite amendment evidence, change commercial lifecycle rules, or weaken the existing tenant-bound room-type/rate-plan relation tuples.

The Prisma commercial-amendment fragment now maps the compact foreign-key and index names directly.

## Rental inventory lookup cleanup

The original rental inventory and availability-hold migrations create three lookup indexes above PostgreSQL's 63-byte identifier limit:

- availability block organization/unit/date lookup;
- rate-period organization/unit-type/date lookup; and
- availability-hold organization/unit/status/date lookup.

These names truncate to three distinct stored identifiers, so they do not block the migration chain, but retaining the implicit truncated names leaves unnecessary physical-name ambiguity for Prisma drift checks and later migrations.

The `20260922092500-rental-inventory-identifier-portability` migration renames those exact stored indexes to compact permanent names. The migration is rename-only and leaves index columns, rental availability semantics, pricing behavior, tenant-bound relations, and retained data unchanged.

`prisma/rental-inventory.prisma` now maps the three final physical index names explicitly.

## Hospitality invoice legal-document cleanup

The original adjustment-note migration creates `hospitality_issued_adjustment_notes_org_jurisdiction_type_sequence_key`, a 70-byte unique-index name for the tenant/jurisdiction/document-type/sequence tuple. PostgreSQL stores it as the 63-byte `hospitality_issued_adjustment_notes_org_jurisdiction_type_seque` identifier. This does not collide with the adjacent document-number index, but leaving the truncated physical name behind creates avoidable Prisma drift ambiguity in legal-document numbering authority.

The `20260922111500-hospitality-invoice-identifier-portability` migration renames that exact stored index to `hospitality_adj_notes_org_jurisdiction_type_sequence_key`. The migration is rename-only: it does not rebuild legal-document evidence, change sequence values, rewrite money, or alter adjustment-note lifecycle semantics. `prisma/invoice-foundation.prisma` maps the compact final name while preserving the existing unique tuple.

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

`scripts/hospitality-commercial-amendment-postgresql-identifier-portability-source-contract.test.mjs` verifies that:

- all three historical commercial-amendment names genuinely exceed the PostgreSQL limit and resolve to distinct 63-byte stored identifiers;
- the portability migration renames those exact stored identifiers to bounded unique names without create/drop/data-write statements;
- Prisma maps the final physical foreign-key/index names; and
- current room-type/rate-plan tenant authority plus the booking/status/expiry lookup tuple remain unchanged.

`scripts/rental-inventory-postgresql-identifier-portability-source-contract.test.mjs` verifies that:

- the rental inventory/hold foundations contain exactly the three known overlong schema object names in this scope;
- all three legacy names resolve to distinct exact 63-byte PostgreSQL identifiers;
- the portability migration is rename-only and maps them to bounded unique names;
- Prisma maps the final availability-block, rate-period, and hold lookup names; and
- lookup column tuples plus tenant-bound unit/unit-type relations remain unchanged.

`scripts/hospitality-invoice-postgresql-identifier-portability-source-contract.test.mjs` verifies that:

- the adjustment-note foundation has exactly one overlong schema object in this focused numbering scope;
- the migration renames the exact 63-byte PostgreSQL-stored identifier without rebuilding evidence;
- Prisma preserves the tenant/jurisdiction/document-type/sequence uniqueness under the compact final name; and
- every explicit physical name in the invoice Prisma fragment fits PostgreSQL's identifier limit.

The live migration gate still requires `npm run test:database` against an explicitly disposable PostgreSQL target before the database checklist can be marked complete. GitHub Actions are not required or used.
