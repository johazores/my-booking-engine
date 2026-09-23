# Payment receipt history boundary

## Scope

SF payment receipts are presentation documents derived from persisted booking and payment evidence. They are not jurisdiction-specific tax invoices and they do not create payment, refund, settlement, or legal-document authority.

Both authenticated staff receipts and public capability-owned receipts use the same successful-only tenant + booking evidence boundary. The reader queries only `SUCCEEDED` payment transactions because failed, pending, and ambiguous attempts are not receipt activity and must not appear as settled customer evidence.

## Bounded successful activity

`readHospitalityPaymentReceiptHistory` reads successful receipt evidence in deterministic 100-row cursor pages by immutable payment transaction ID. Every returned row is revalidated against the requested organization and booking, must still be `SUCCEEDED`, and must carry a valid database creation timestamp. The reader then restores deterministic `createdAt` + ID chronology for the receipt projection.

The synchronous presentation ceiling is 1,000 successful transactions for one hospitality booking. Exactly 1,000 rows are accepted only after a one-row overflow probe proves the successful history is complete. Above that limit the reader fails closed. SF does not silently truncate a receipt or present a partial customer settlement history as complete.

This 1,000-row successful-only boundary is intentionally separate from whole-ledger financial authority. Refund execution, commercial-amendment settlement, recovery, provider reconciliation, and legal-document decisions continue to use their stricter complete-history or exact-identity contracts. A receipt read is not financial authority merely because it observes successful payment rows.

## Authorization and tenant isolation

Authenticated staff access still requires `payment:read` for the active organization before the receipt is built. The receipt history itself is scoped by both `organizationId` and `bookingId`, and the booking read uses the same tenant identity.

Public receipt access still requires a valid organization-bound booking capability, persisted booking ownership, the matching unexpired public principal, and a tenant-owned booking. The same bounded history reader is called with the verified organization and capability booking IDs. Incomplete history becomes a conflict and no receipt payload is returned.

## Failure behavior

Receipt generation fails closed when successful history escapes tenant scope, contains invalid persisted chronology, or exceeds the synchronous presentation ceiling. Existing receipt-domain validation still rejects currency mismatches, unsupported successful transaction evidence, over-refund, or missing captured payment.

No provider API is called by receipt rendering, and provider-specific behavior remains behind payment adapters elsewhere in the product.
