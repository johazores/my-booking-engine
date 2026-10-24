# Bounded browser form ingress

Production browser form mutation routes use a shared text-only bounded parser in `src/server/http/bounded-form-body.ts`. This applies to sign-in/sign-up, organization and membership management, customers, pricing, branding, tenant integration management, and inventory. Inventory retains its compatibility wrapper `src/server/inventory/inventory-form-body.ts`.

The parser accepts `application/x-www-form-urlencoded` and `multipart/form-data` with text fields only. It enforces a 64 KiB streamed limit, a 64-field maximum, field names no longer than 100 characters, no duplicate/empty/NUL-containing names, no NUL-containing values, strict UTF-8 including percent-encoded URL form components, and consistent declared body lengths when supplied. It rejects file uploads and malformed multipart bodies. Form parsing errors are customer-correctable validation failures and must never expose submitted credentials.

All migrated routes continue to check same-origin and supported form media types before reading the body. Existing authenticated routes also resolve the session and active tenant before parsing. The shared transport parser does not grant permissions; all business writes remain server-authorized and tenant-scoped. Auth sign-in/sign-up intentionally have no existing session requirement.

`scripts/form-request-ingress-contract.test.mjs` prevents production API routes from returning to unbounded `request.formData()` and checks origin/media-type guards on the migrated route group. `src/server/inventory/inventory-form-body.test.ts` tests the parser through the inventory wrapper and throwing adapter.

These focused checks do not replace full Node 24, Prisma, PostgreSQL, lint, typecheck, and production-build validation. No GitHub Actions are used.

## Already-used request streams

The shared reader treats a locked or previously consumed request body as an invalid submission rather than allowing `ReadableStream.getReader()` to escape as an unexpected server error. Failed streams are also rejected without returning submitted values. The inventory wrapper and throwing form adapter preserve their existing null/validation-error contracts. These checks do not weaken origin, session, tenant, or capability enforcement.
