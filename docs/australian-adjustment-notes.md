# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is separately numbered immutable legal evidence; SF does not provide a generic staff-entered credit-note workflow.

Reachable issuance is AU/AUD under the current fully taxable standard-GST contract. It supports an unadjusted full booking cancellation, direction-aware first/repeated commercial amendments from the verified current legal chain head, and a terminal full cancellation after a verified commercial chain.

## Supported reachable events

### Booking cancellation before commercial adjustments

`DECREASING / BOOKING_CANCELLATION` schema version 1 requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching the source total/currency, settlement-source authority, and exact standard-GST reconciliation. It remains ordinal `1`.

### Booking cancellation after commercial adjustments

Schema version 6 represents one terminal `DECREASING / BOOKING_CANCELLATION` at ordinal `2+`. Its legal before-price is the verified commercial chain-head after-price, not the original source invoice total. It requires current booking cancellation/refund state, issue-time provider-neutral settlement equal to the chain-head legal price, current issue-time settlement reduced exactly to zero, and an ordered bounded set of successful source-attributed non-commercial refunds whose total equals that legal price.

The terminal document binds the immediate commercial predecessor and freezes its document/pricing fingerprints plus the exact refund-authority set. After terminal cancellation no further commercial adjustment is writable.

### Decreasing commercial amendments

The first decrease requires the source tax invoice to equal the frozen amendment before-price, one exact applied `REFUND` amendment, exactly one target-pricing evidence record matching the after-price, exact standard GST, complete provider-neutral settlement, valid chronology, and no earlier adjustment. It uses schema version 2 / ordinal `1`.

Repeated decreases use schema version 3 / ordinal `2+`. Each before-price must equal the verified predecessor after-price. Immutable evidence binds predecessor ID/ordinal/document number/time/fingerprint and pricing continuity. The predecessor may be decreasing or increasing.

### Increasing commercial amendments

The first increase requires the immutable source tax invoice to equal the amendment before-price, one applied `ADDITIONAL_CHARGE` amendment, one immutable target-pricing record matching the after-price, exact positive standard-GST effect, complete provider-neutral settlement, valid chronology, and no earlier adjustment. It uses schema version 4 / ordinal `1`.

Schema version 5 is used for repeated increasing commercial adjustments at ordinal `2+`. The current before-price must equal the complete verified chain-head after-price. Immutable evidence freezes immediate predecessor identity, prior ordinal, document number/time/fingerprint, predecessor after-pricing fingerprint, and the exact positive increase effect.

Together, schema versions 2 through 5 support alternating commercial directions. Legal direction is never caller-selected.

## Shared commercial legal-chain verification

The bounded tenant-scoped commercial adjustment verifier supports schema versions 2 through 5 and both directions. It rejects gaps, forks, duplicate authority, unsupported direction/schema combinations, baseline or target-pricing drift, chronology regressions, issuer/recipient changes, invalid standard-GST effects, and settlement that does not reconcile.

Each row's payment authority is independently re-proved from a progressive provider-neutral ledger restricted to transactions created no later than that document's issue time: base booking payment truth plus only commercial-amendment transactions belonging to the verified chain through that ordinal.

Historical reads can tolerate exactly one structurally terminal cancellation after the verified commercial chain without treating it as a commercial member. The write-head selector does not enable that tolerance, so a terminal cancellation remains terminal.

## Product issuance boundary

Commercial issuance uses `getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote`. They require `payment:manage`, tenant/booking/source authority, derive direction from persisted amendments, verify the complete current commercial chain, and reject current-baseline ambiguity.

Cancellation issuance now converges through `hospitality-cancellation-adjustment-product-service.ts`. The product boundary requires `payment:manage`, tenant/booking/AU source authority, inspects persisted legal evidence server-side, and selects either the schema-version-1 unadjusted cancellation contract or the schema-version-6 terminal-after-amendment contract. Existing cancellation links are exposed only after the verifier matching their evidence schema succeeds.

For an unadjusted cancellation, the product boundary obtains the unique eligible full-refund ID from the protected legacy availability service and passes it only to the lower server writer, which revalidates it inside its serializable transaction. For a terminal cancellation, the server re-derives the complete commercial head and refund-authority set. The HTTP request for both contracts contains only the source invoice number.

The browser never selects or receives cancellation refund IDs as write authority, and never selects direction, GST, money, ordinal, predecessor, provider truth, sequence, fingerprint, or issue time.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require `booking:read` plus `payment:read` and are tenant-scoped server-side. Public booking-capability history authorizes tenant slug, encrypted capability, persisted ownership, unexpired principal, and tenant-owned booking before legal documents are returned.

`hospitality-issued-adjustment-note-authority-service.ts` dispatches schema-version-1 cancellation, schema-version-6 terminal cancellation, and commercial schema-version-2-through-5 evidence to their independent authority verifiers. Staff detail/register/accounting, reconciliation, public history, authenticated/public HTML, and deterministic PDF delivery therefore inherit the same validated document boundary.

Customer projections exclude internal predecessor/amendment/target IDs, fingerprints, actors, and provider/payment/refund references unless legally required.

## Remaining production boundaries

Mixed taxability, partial/non-standard-GST rules, arbitrary staff-entered reasons, generic reissue/void/correction, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
