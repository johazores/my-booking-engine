# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The persisted authority model is versioned so the original booking-cancellation implementation remains readable while the platform can support additional decreasing-adjustment authorities without pretending that one payment refund row represents the whole legal event.

## Current authority model

Schema version 2 records the adjustment reason and authority independently and requires them to agree. `BOOKING_CANCELLATION` is authorized by exactly one successful full-booking refund transaction. `COMMERCIAL_AMENDMENT` is authorized by the exact applied commercial amendment and deliberately does not require or persist one synthetic refund transaction as legal authority.

Each new v2 document also records an adjustment ordinal, an optional predecessor adjustment-note id, the price before the adjustment and the resulting price after it. The decrease must equal before minus after, the supported standard-GST contract must reconcile exactly, and the first adjustment begins from the immutable source tax-invoice total. Later adjustments must form an ordered predecessor chain against the same source invoice and tenant.

The PostgreSQL migration adds composite tenant/resource foreign keys for source invoices, refund transactions, commercial amendments and predecessor adjustment notes. Authority/reason exclusivity, ordering, before/after money reconciliation and supported GST invariants are enforced with database checks in addition to service validation.

## Legacy documents

Existing schema-v1 cancellation snapshots are not rewritten. Their original JSON and document fingerprints remain authoritative and continue to parse through the compatibility contract. Material columns are backfilled only with facts already implied by the old cancellation contract: cancellation-refund authority, ordinal 1, baseline equal to the original full decrease and resulting total zero.

## Read integrity

Authenticated register, detail, PDF, accounting and reconciliation reads validate the immutable row/snapshot/fingerprint and then validate linked authority server-side. Source invoices, refunds, commercial amendments and predecessor notes are always loaded within the active organization and, where a booking is known, the same booking scope. A malformed, cross-tenant, broken-chain or stale authority fails closed.

Public booking document reads remain capability/ownership/principal/booking authorized before document evidence is exposed. Commercial-amendment issuance is still closed, so no public workflow presents an unissued commercial adjustment as real.

## Issuance boundary

The existing booking-cancellation issuance workflow remains the only live adjustment-note writer. It now emits schema-v2 cancellation evidence while preserving the previous `payment:manage`, serializable transaction, source-invoice, full-refund and audit requirements.

Commercial-amendment readiness is not commercial-amendment issuance. The persistence prerequisite is now available, but SF must still implement and validate an idempotent serializable commercial-amendment issuance workflow that binds the exact applied amendment, derives cumulative before/after authority correctly, proves settlement where required, and survives concurrency/retry tests against PostgreSQL before any issuance CTA or API is enabled.

## Validation status

Dependency-free domain and deterministic-PDF tests cover both schema-v2 authority forms, legacy-v1 compatibility, exact GST/decrease calculations, chronology, numbering, invalid dual authority and broken ordering. Full repository Node 24, Prisma migration and PostgreSQL concurrency/integration validation remains required in an environment that provides the repository toolchain and an explicitly disposable database target.
