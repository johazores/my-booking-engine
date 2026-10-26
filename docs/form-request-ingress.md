# Bounded browser form ingress

Production browser form mutation routes use a shared text-only bounded parser in `src/server/http/bounded-form-body.ts`. This applies to sign-in/sign-up, organization and membership management, customers, pricing, branding, tenant integration management, and inventory. Inventory retains its compatibility wrapper `src/server/inventory/inventory-form-body.ts`.

The parser accepts `application/x-www-form-urlencoded` and `multipart/form-data` with text fields only. It enforces a 64 KiB streamed limit, a 16,384-chunk limit (including empty chunks), a 64-field maximum, field names no longer than 100 characters, no duplicate/empty/NUL-containing names, no NUL-containing values, strict UTF-8 including percent-encoded URL form components, and consistent declared body lengths when supplied. It rejects file uploads and malformed multipart bodies. Form parsing errors are customer-correctable validation failures and must never expose submitted credentials.

All migrated routes continue to check same-origin and supported form media types before reading the body. Existing authenticated routes also resolve the session and active tenant before parsing. The shared transport parser does not grant permissions; all business writes remain server-authorized and tenant-scoped. Auth sign-in/sign-up intentionally have no existing session requirement.

`scripts/form-request-ingress-contract.test.mjs` prevents production API routes from returning to unbounded `request.formData()` and checks origin/media-type guards on the migrated route group. `src/server/inventory/inventory-form-body.test.ts` tests the parser through the inventory wrapper and throwing adapter.

These focused checks do not replace full Node 24, Prisma, PostgreSQL, lint, typecheck, and production-build validation. No GitHub Actions are used.

## Already-used request streams

The shared reader treats a locked or previously consumed request body as an invalid submission rather than allowing `ReadableStream.getReader()` to escape as an unexpected server error. Failed streams are also rejected without returning submitted values. The inventory wrapper and throwing form adapter preserve their existing null/validation-error contracts. These checks do not weaken origin, session, tenant, or capability enforcement.

A consumed stream can have its reader lock released while `Request.bodyUsed` stays true. In that case a second `getReader()` may succeed and return an empty stream. The shared form reader checks `bodyUsed` before acquiring the reader so previously consumed submissions cannot be mistaken for valid empty forms. Regression coverage includes this unlocked-consumed case.

## Stream chunk resource ceiling

The shared form reader also caps the number of stream chunks independently of byte length, so a request supplying endless zero-byte chunks or excessive tiny chunks cannot monopolize parsing while staying below 64 KiB. Empty chunks count toward the ceiling but are not retained. Exceeding the ceiling cancels the request reader and returns the existing invalid-form result; authorization and tenant checks remain unchanged.

## Whole-body deadline and caller abort

Browser form ingress now enforces the same 10-second total stream-acquisition deadline as the shared JSON reader. It also rejects client-aborted reads promptly even when an upstream stream ignores cancellation. Cancellation remains best-effort/nonblocking. A test-only override may shorten but cannot extend the production ceiling. Existing same-origin, authentication, tenant, text-only, byte/chunk, and validation contracts remain unchanged. Regression tests cover stalled reads, client aborts, and invalid deadline overrides.

## Rejected unread request cleanup

Form transport preflight now discards unread request streams best-effort on unsupported media types, invalid size/deadline policies, malformed or oversized declared lengths, and already-aborted submissions. The rejection does not wait for upstream cancellation, and locked or previously consumed bodies are not stolen from another reader. The existing origin, tenant, permission, streamed-size, text-only, and form-field validation requirements remain unchanged.

## Failed-read cleanup

The shared request-body deadline helper also cancels the acquired form stream reader after a rejected or synchronously throwing `read()`. Failure resolution removes abort listeners before best-effort cancellation, avoiding duplicate cancellation if a late rejection follows an abort or cancellation itself triggers an abort. Cancellation never blocks the invalid-form response and cannot replace its validation classification. The existing form, origin, authentication, tenant, and permission boundaries remain unchanged.
