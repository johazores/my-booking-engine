# Invoice and legal pricing evidence foundation

## Status

SF now has three internal immutable-evidence layers for future jurisdiction-specific hospitality invoices and tax documents:

1. accepted-state `HospitalityBookingPricingEvidence` for the exact commercial line items;
2. versioned tenant-owned `InvoiceIssuerProfile` snapshots for declared legal issuer identity; and
3. `HospitalityInvoicePreparation`, which binds one accepted booking pricing-evidence row to one exact issuer-profile version with deterministic fingerprints and money totals.

These records are a production data foundation only. SF still does **not** issue a jurisdiction-specific legal invoice, tax invoice, fiscal receipt, or credit note. The existing customer-safe payment receipt remains the supported settlement document and must not be relabeled as a regulated document.

## Immutable booking pricing evidence

`HospitalityBookingPricingEvidence` is an append-only application record scoped by organization and booking. When applicable it is also bound to a commercial amendment through the same organization + booking + amendment identity enforced by the database.

Each evidence row freezes organization/booking ownership, source/version, commercial stay/scope/selections, exact currency and aggregate money, the accepted pricing fingerprint, and a canonical schema-versioned nightly/tax/fee/add-on breakdown. Database checks and composite foreign keys independently reinforce tenant/resource ownership, date/quantity/currency/fingerprint shape, aggregate reconciliation, JSON shape, evidence identity, and amendment/source consistency.

Pricing evidence is written inside the same protected database transaction as the accepted commercial state. Booking confirmation, same-price rescheduling, zero-delta commercial modification, and non-zero amendment preparation all freeze authoritative server-derived pricing rather than browser totals.

## Versioned issuer identity

`InvoiceIssuerProfile` stores a normalized, schema-versioned snapshot of the tenant-declared issuer identity: legal name, business address, country code, optional contact email, and zero or more declared registration identifiers. Every snapshot receives a deterministic SHA-256 fingerprint and a monotonically increasing organization-scoped version.

Creating or reading the current issuer profile requires `organization-settings:manage`. The service validates tenant/actor identifiers, revalidates active organization access, normalizes input, and writes new versions in a serializable transaction. Exact retries of the current profile are idempotent; a later return to older legal details creates another version instead of mutating history. Concurrent version allocation retries bounded serialization/uniqueness conflicts and fails safely if it cannot converge.

Issuer-profile audit events include the version, fingerprint, country, and registration schemes/countries. Registration identifier values are deliberately omitted from audit JSON.

A country code or tenant-entered registration does **not** mean SF has validated that registration with a tax authority, determined tax residence, or declared the jurisdiction supported. These values are immutable tenant-declared identity evidence only until a supported-jurisdiction contract defines their legal meaning and validation requirements.

## Invoice preparation evidence

`HospitalityInvoicePreparation` is an internal immutable preparation record. It is not an issued document and has no fiscal number, issuance timestamp, delivery state, PDF, or legal wording.

`prepareHospitalityInvoice` requires `payment:manage` and derives all authority server-side. Inside a serializable transaction it resolves the exact tenant-owned booking, allows only an accepted confirmed/cancelled commercial state, resolves the latest issuer profile, finds immutable pricing evidence that exactly matches the booking, reparses and revalidates the complete breakdown, and refuses to reconstruct missing historical lines from current mutable pricing rules.

The preparation snapshot binds the exact pricing-evidence ID, issuer-profile ID, currency, accommodation/tax/fee/add-on/final minor-unit amounts, pricing fingerprint, and issuer fingerprint. Deterministic organization/booking-scoped identity makes exact retries idempotent. If accepted pricing or the issuer version changes, preparation creates a new immutable record rather than rewriting the old one.

Composite database foreign keys require the preparation, booking, pricing evidence, issuer profile, and organization to agree. Database checks also enforce currency/fingerprint/key shape, exact aggregate money, and snapshot-to-column identity/money consistency.

There is intentionally no public or browser write route for pricing evidence, issuer evidence, or invoice preparation. A future legal issuance workflow must consume these server-owned records; it may not accept browser-supplied totals, tax registrations, issuer identity, evidence IDs, or fiscal numbers as authority.

## Legacy records and fail-closed policy

Bookings and amendments created before the pricing-evidence migration can legitimately have no `HospitalityBookingPricingEvidence` row. SF must not fabricate historical legal line items by re-reading today's mutable pricing configuration because labels, tax rules, applicability, and other descriptive/legal facts may have changed since the original transaction.

Invoice preparation therefore fails closed when matching immutable pricing evidence is absent. Any future historical reconciliation/backfill process must be deliberate, auditable, and based on trustworthy original records rather than current pricing configuration.

## What this still does not implement

The Phase 12 legal invoice/tax checklist remains open. The following are still required before SF can claim jurisdiction-specific issuance:

- a product-selected supported jurisdiction contract and explicit tax-characterization rules, including inclusive/exclusive treatment, exemptions, and required legal fields;
- verification semantics for issuer registrations where required;
- customer legal/billing identity fields and immutable billing snapshots where required;
- tenant/jurisdiction/document-type fiscal numbering with concurrency-safe uniqueness and immutable issuance timestamps;
- invoice/tax-invoice/fiscal-receipt/credit-note lifecycle, including correction, void, reissue, and refund/credit allocation rules;
- legally required wording, currency/exchange-rate disclosures, localization, and retention requirements;
- deterministic document rendering/PDF generation from immutable issued evidence;
- authenticated/public-safe document access, delivery/email, resend/history, and revocation rules;
- accounting/export/provider integration requirements where product scope requires them; and
- explicit production validation for every supported jurisdiction.

No invoice UI, PDF, email action, fiscal number, legal tax wording, or customer-visible tax-invoice label should be introduced until those persisted authorities and lifecycle rules exist. Placeholder or inferred legal data is not acceptable.

## Validation boundary

Dependency-free issuer-profile and invoice-preparation domain tests cover canonicalization, deterministic fingerprints, strict persisted parsing, registration validation, exact-money reconciliation, UUID/currency/fingerprint validation, and deterministic preparation identity.

A disposable PostgreSQL integration test covers tenant permissions, issuer version idempotency, historical-version preservation, preparation idempotency, issuer-version changes, audit redaction, and database rejection of cross-tenant preparation ownership. It is wired into the existing local `test:database` runner.

Full Prisma migration/deploy/drift validation, the new database integration test, complete Node 24 typecheck/lint/test, and production build still require the repository's Node 24 dependency checkout plus an explicitly disposable PostgreSQL target. GitHub Actions are not used.

## Next dependency

The next coherent invoice slice is to define the first supported jurisdiction contract and billing-identity requirements. Only after that legal contract is explicit should SF add concurrency-safe fiscal numbering and an issued invoice/credit-note state machine. Rendering, customer delivery/email, and accounting export come after immutable issuance authority exists.
