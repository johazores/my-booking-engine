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

## Regression protection

`scripts/rental-postgresql-identifier-portability-source-contract.test.mjs` verifies that:

- every legacy rename source is exactly 63 bytes;
- every replacement identifier fits within the PostgreSQL limit;
- replacement names are unique;
- Prisma mapped names fit the same limit and match the final database names;
- trigger renames retain their intended table scope and do not drop or recreate evidence objects.

The live migration gate still requires `npm run test:database` against an explicitly disposable PostgreSQL target before the database checklist can be marked complete. GitHub Actions are not required or used.
