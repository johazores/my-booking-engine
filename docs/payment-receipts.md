# Payment receipts

SF exposes read-only payment receipts for hospitality bookings with proven successful monetary settlement. Receipts are derived from immutable booking price snapshots plus persisted successful payment/refund ledger rows; they do not create a second money source of truth.

## Security and tenant scope

Authenticated staff use `getBookingPaymentReceipt`, which requires `payment:read`, validates organization/user/booking identifiers, and selects the booking by `(bookingId, organizationId)`. Cross-tenant booking IDs resolve as unavailable rather than leaking receipt data. The staff endpoint is `GET /api/payments/receipt?bookingId=...` and uses the active-organization payment API context.

Public-booking customers use `POST /api/public-bookings/[organization-slug]/hospitality/payments/receipt`. The request contains only the opaque booking capability. The server resolves the tenant from the slug, verifies the encrypted `booking:manage` capability, then independently verifies `PublicBookingBookingOwnership` and the unexpired tenant-bound public principal before reading the booking or payment ledger. The endpoint is same-origin only, `no-store`, and does not accept organization, booking, customer, provider, money, or transaction identifiers as browser authority.

The public booking page copies the short-lived booking capability from same-tab recovery storage into a receipt-only sessionStorage slot before payment recovery can clear its Checkout state. This permits the customer to refresh the verified receipt in the same browser tab while the existing capability remains valid, without putting the capability in a URL or creating a new identity/recovery mechanism.

## Receipt semantics

A receipt is available only after a booking has reached a settled payment state: `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED`. Confirmed bookings and later-cancelled bookings retain access to their historical successful settlement evidence. Pending confirmation, unpaid, authorized-only, and failed payment states cannot produce a successful-payment receipt.

Only `SUCCEEDED` ledger rows participate. Successful capture rows and real offline payments contribute captured money; successful refunds reduce net settlement. Authorization holds do not count as money received. The existing direct-settlement fallback is retained only when the booking itself proves a settled state and there is no capture/offline-payment row; in that case the final successful authorization evidence can represent the provider lifecycle that settled directly.

Receipt derivation fails closed when successful ledger money has a different currency from the immutable booking currency, has a non-positive amount, has no captured settlement evidence, or claims refunds greater than captured money. Internal `sf_claim_*` references are sanitized. The staff receipt retains customer-safe provider references for operational audit; the public receipt intentionally exposes no provider references, transaction IDs, idempotency keys, fingerprints, credentials, or card data.

The response includes a deterministic receipt number derived from the booking UUID, tenant business/contact identity, the attached customer, stay/room/rate data, immutable accommodation/tax/fee/add-on/total snapshots, captured/refunded/net-paid totals using integer minor units, and chronological customer-safe `PAYMENT` / `REFUND` activity. The public UI renders those stored values and supports refreshing the receipt so later verified refunds are reflected.

## Tax and fee boundary

`taxTotalMinor` and `feeTotalMinor` on the receipt remain the accepted aggregate booking pricing values. The receipt contract intentionally does not re-read current mutable pricing rules to invent historical tax or fee descriptions.

SF now separately persists append-only `HospitalityBookingPricingEvidence` for newly accepted booking/commercial states. That evidence freezes the canonical nightly, tax/fee, and add-on breakdown together with exact aggregates, commercial scope, stay, selections, and pricing fingerprint. It is written through protected server booking/amendment transactions and is not customer/browser authority. Historical bookings created before the evidence migration can legitimately have no such row and are not automatically reconstructed from today's pricing configuration.

The presence of immutable pricing evidence does **not** make this payment receipt a jurisdiction-specific tax invoice. SF still lacks the full legal issuer/tax-registration/billing identity, jurisdiction-specific tax characterization, concurrency-safe fiscal numbering, invoice/credit-note lifecycle, required legal wording, rendering/delivery, retention, and accounting contracts needed to issue regulated documents. The receipt therefore does not invent invoice numbers, VAT/GST registration values, legal tax wording, PDF tax invoices, or accounting synchronization. See `docs/invoice-foundation.md` for the production boundary and remaining dependencies.

## Provider truth

A browser redirect is never payment evidence. Receipt availability comes only from persisted server-side settlement state established through real manual recording or verified provider processing, reconciliation, and signed webhooks. Pending, ambiguous, failed, and internal pre-provider claims are excluded from successful monetary proof.

## Validation

Dependency-free receipt-domain tests cover deterministic numbering, successful-only filtering, internal-reference sanitization, currency and non-positive-money rejection, capture/refund arithmetic, authorization exclusion/direct-settlement fallback, and customer-safe activity projection. Booking pricing-evidence domain tests independently cover canonical line-item evidence, strict persisted parsing, aggregate reconciliation, stay/add-on commercial-state matching, and malformed evidence rejection.

Full repository validation, Prisma checks, PostgreSQL integration execution, and production build remain subject to the repository's Node 24 and disposable-database local gates. GitHub Actions are not used.
