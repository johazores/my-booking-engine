# Invoice and legal pricing evidence foundation

## Status

SF has three internal immutable-evidence layers for future jurisdiction-specific hospitality invoices and tax documents:

1. accepted-state `HospitalityBookingPricingEvidence` for the exact commercial line items;
2. versioned tenant-owned `InvoiceIssuerProfile` snapshots for declared legal issuer identity; and
3. `HospitalityInvoicePreparation`, which binds one accepted booking pricing-evidence row to one exact issuer-profile version with deterministic fingerprints and money totals.

Australia is now the first explicit jurisdiction content contract. `assessHospitalityAustralianTaxInvoiceReadiness` applies that contract to tenant-owned immutable preparation evidence, issuer identity, accepted pricing evidence, and the booking customer. This is still a readiness boundary only. SF does **not** yet issue an Australian tax invoice, fiscal receipt, credit note, or any other regulated document.

The existing customer-safe payment receipt remains the supported settlement document and must not be relabeled as a regulated invoice.

## Immutable booking pricing evidence

`HospitalityBookingPricingEvidence` is an append-only application record scoped by organization and booking. When applicable it is also bound to a commercial amendment through the same organization + booking + amendment identity enforced by the database.

Each row freezes organization/booking ownership, source/version, commercial stay/scope/selections, exact currency and aggregate money, the accepted pricing fingerprint, and a canonical schema-versioned nightly/tax/fee/add-on breakdown. Database checks and composite foreign keys independently reinforce tenant/resource ownership, date/quantity/currency/fingerprint shape, aggregate reconciliation, JSON shape, evidence identity, and amendment/source consistency.

Pricing evidence is written inside the same protected database transaction as the accepted commercial state. Booking confirmation, same-price rescheduling, zero-delta commercial modification, and non-zero amendment preparation all freeze authoritative server-derived pricing rather than browser totals.

## Versioned issuer identity

`InvoiceIssuerProfile` stores a normalized, schema-versioned snapshot of the tenant-declared issuer identity: legal name, business address, country code, optional contact email, and zero or more declared registration identifiers. Every snapshot receives a deterministic SHA-256 fingerprint and a monotonically increasing organization-scoped version.

Creating or reading the current issuer profile requires `organization-settings:manage`. Exact retries of the current profile are idempotent; a later return to older legal details creates another version rather than mutating history. Audit events include version/fingerprint/country and registration schemes/countries while deliberately excluding registration identifier values.

A tenant-entered registration is a declaration, not external registry verification. For the initial Australian content contract, `ABN` and `GST` declarations must both use the same structurally valid ABN. SF validates the published ABN checksum during Australian readiness assessment but does not currently call ABN Lookup or the ATO to prove live registration status.

## Invoice preparation evidence

`HospitalityInvoicePreparation` is an internal immutable preparation record. It is not an issued document and has no fiscal number, issuance timestamp, delivery state, PDF, or legal wording.

`prepareHospitalityInvoice` requires `payment:manage` and derives all authority server-side. Inside a serializable transaction it resolves the tenant-owned booking, allows only an accepted confirmed/cancelled commercial state, resolves the latest issuer profile, finds immutable pricing evidence that exactly matches the booking, reparses/revalidates the complete breakdown, and refuses to reconstruct missing historical lines from current mutable pricing rules.

The preparation snapshot binds the exact pricing-evidence ID, issuer-profile ID, currency, accommodation/tax/fee/add-on/final minor-unit amounts, pricing fingerprint, and issuer fingerprint. Deterministic organization/booking-scoped identity makes exact retries idempotent. If accepted pricing or the issuer version changes, preparation creates a new immutable record rather than rewriting the old one.

Composite database foreign keys require the preparation, booking, pricing evidence, issuer profile, and organization to agree. Database checks also enforce currency/fingerprint/key shape, exact aggregate money, and snapshot-to-column identity/money consistency.

There is intentionally no public/browser write route for pricing evidence, issuer evidence, or invoice preparation.

## Australian content readiness

The first jurisdiction contract is documented in `docs/australian-tax-invoice-contract.md` and is deliberately narrow. It currently accepts only AU issuers, AUD bookings, one valid ABN declaration, one GST declaration using the same ABN, exactly one persisted `GST` tax line, no other tax scheme, and fully taxable standard-GST money where GST is exactly one-eleventh of the GST-inclusive accepted total. At AUD 1,000 or more, buyer identity is required.

`assessHospitalityAustralianTaxInvoiceReadiness` requires `payment:manage` and accepts only organization, actor, and immutable preparation IDs. It tenant-scopes the preparation, booking/customer, issuer, and pricing evidence inside a serializable read transaction, verifies their fingerprints/money/ownership, derives buyer identity from the booking customer, and then applies the Australian domain rules. Callers cannot provide ABN, GST amount, buyer identity, currency, totals, or tax lines as authority.

Its `contentReady` result means only that the available evidence satisfies this intentionally limited content contract. It must never be treated as legal issuance success.

## Legacy records and fail-closed policy

Bookings and amendments created before the pricing-evidence migration can legitimately have no `HospitalityBookingPricingEvidence` row. SF must not fabricate historical legal line items by re-reading today's mutable pricing configuration because labels, tax rules, applicability, and other descriptive/legal facts may have changed since the original transaction.

Invoice preparation therefore fails closed when matching immutable pricing evidence is absent. Any future historical reconciliation/backfill must be deliberate, auditable, and based on trustworthy original records rather than current pricing configuration.

## What still blocks legal issuance

The Phase 12 legal invoice/tax checklist remains open. Even for Australia, the following are still required before SF can claim regulated issuance:

- immutable invoice-recipient/billing evidence captured for the exact document, including a business-recipient/ABN path;
- richer persisted taxability semantics for mixed taxable, GST-free, input-taxed, exempt, or otherwise distinct supply treatment where needed;
- an explicit policy for live issuer-registration verification where product/legal requirements demand it;
- tenant/jurisdiction/document-type fiscal numbering with concurrency-safe uniqueness and immutable issuance timestamps;
- invoice/tax-invoice/fiscal-receipt/credit-note lifecycle including correction, void, reissue, and refund/credit allocation rules;
- legally required wording, currency/exchange-rate disclosures, localization, and retention requirements;
- deterministic document rendering/PDF generation from immutable issued evidence;
- authenticated/public-safe document access, delivery/email, resend/history, and revocation rules;
- accounting/export/provider integration requirements where product scope requires them; and
- explicit production validation for every supported jurisdiction.

No invoice UI, PDF, email action, fiscal number, legal tax wording, or customer-visible tax-invoice label should be introduced until those persisted authorities and lifecycle rules exist. Placeholder or inferred legal data is not acceptable.

## Validation boundary

Dependency-free tests cover issuer-profile canonicalization, invoice-preparation identity, the published Australian ABN checksum, Australia-specific currency/threshold/GST declaration rules, mixed-tax rejection, and exact GST-money reconciliation.

A disposable PostgreSQL integration test covers tenant permissions, issuer version idempotency, historical-version preservation, preparation idempotency, issuer-version changes, audit redaction, and database rejection of cross-tenant preparation ownership. The guarded database suite remains the required execution boundary for database-backed invoice work.

Full Prisma migration/deploy/drift validation, database integration execution, complete Node 24 typecheck/lint/test, and production build require the repository's Node 24 dependency checkout plus an explicitly disposable PostgreSQL target. GitHub Actions are not used.

## Next dependency

The next coherent invoice slice is immutable recipient/billing evidence plus the remaining Australian taxability authority needed by the supported content contract. Only after that evidence is durable should SF add concurrency-safe fiscal numbering and an immutable issued invoice/credit-note state machine. Rendering, customer delivery/email, and accounting export come after issuance authority exists.
