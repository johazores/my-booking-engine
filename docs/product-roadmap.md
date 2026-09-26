# Product Roadmap

This roadmap follows dependency order. Finish the highest-priority dependency first, but once a dependency cluster is complete an engineering run should continue into the next safe dependency when capacity remains rather than stopping artificially.

Implementation status below describes repository code and checked-in coverage. The guarded PostgreSQL suite still requires an explicitly confirmed disposable target, and full repository validation requires the Node 24 toolchain.

## 1. Repository and architecture foundation — implemented

- clean SF reset with legacy prototype coupling removed
- modern Next.js/TypeScript/Prisma/PostgreSQL baseline
- documentation structure and permanent engineering rules
- modular-monolith boundaries and native CSS/design tokens
- no GitHub Actions dependency

## 2. Database and tenant foundation — implemented in code; disposable PostgreSQL execution remains an environment gate

- PostgreSQL/Prisma schema and checked-in migrations
- organization, user, membership, tenant-owned commercial records, and composite ownership constraints
- tenant-scoped repositories/services
- migration/drift/database verification harness
- checked-in Tenant A/Tenant B isolation and lifecycle scenarios

## 3. Authentication — implemented

First-party email/password authentication, persisted opaque sessions, secure cookies, protected server access, session revocation/expiry behavior, and regression coverage are implemented.

## 4. Organizations and tenant isolation — implemented

Organization onboarding/selection/settings/archive plus server- and database-enforced tenant-safe ownership are implemented across the current protected product surface.

## 5. Roles and permissions — implemented

Platform/organization roles, fine-grained capabilities, permission enforcement, membership lifecycle management, audits, and authorization coverage are implemented.

## 6. Persistent application shell — implemented

The protected workspace has responsive navigation/header, tenant identity, account controls, active states, accessible interaction, and real tenant/auth dashboard data rather than fake analytics.

## 7. Tenant settings and white-label branding — implemented for the current product and public booking journey

Tenant presentation/contact/public-booking configuration, custom-domain configuration, audited management, design-token propagation, and public-safe branding are implemented. Persisted branding is applied to the real `/book/[organization-slug]` journey.

Custom-domain persistence does not claim DNS ownership verification or custom-host routing; that remains an infrastructure capability.

## 8. Customers, travelers, and guests — implemented current booking foundation

Tenant-owned customer/contact records, lifecycle management, search/filter/sort/pagination, audits, and permissions are implemented. Hospitality bookings persist immutable ordered guest snapshots, confirmed-booking traveler snapshots can be edited through the tenant-safe booking-management boundary, and durable rental bookings retain an immutable customer identity/contact snapshot as commercial evidence.

Archived bookingless customer profiles support an irreversible tenant-scoped de-identification action that clears mutable direct identifiers only after `customer:manage`, explicit confirmation, and a write-time re-check that neither hospitality nor rental booking records reference the profile. Booking-linked customer/guest snapshots, provider-held data, backups/exports, and legally retained evidence remain separate reviewed lifecycle work.

## 9. Internal inventory — hospitality, tour, appointment, and rental foundations implemented in code

Implemented hospitality capabilities include properties, room types, physical rooms, amenities, image records, rate plans, assignments, restrictions, lifecycle guards, permissions, management UI, and tenant-safe database relationships.

Implemented tour/package inventory includes tenant-owned products, dated departure schedules, explicit configured capacity, add-ons, dependency-safe archival, audited mutations, bounded management collections, and tenant-composite persistence relationships.

Implemented appointment inventory includes tenant-owned services and staff, explicit staff-to-service eligibility, recurring weekly schedules with overlap protection, dependency-safe archival/removal, audited mutations, bounded management collections, and tenant-composite persistence relationships.

Implemented rental infrastructure includes tenant-owned unit types/products, operating locations, physical units, unit-level unavailable date blocks, default daily prices and date-range rate overrides, location movement, lifecycle guards, bounded management collections, temporary holds with immutable pricing evidence, server-side conversion authority, atomic hold consumption, durable confirmed rental bookings, exact physical-unit allocations, booked-inventory exclusion, customer-retention integration, database-backed inventory race protection, tenant-scoped staff booking list/detail, same-unit price-neutral date rescheduling plus narrow same-unit later-end custody extension with append-only authority/evidence, one supported same-unit price-changing commercial date amendment with reviewed before/after terms, exact manual/offline adjustment/compensation evidence, final locked apply and protected post-apply effective settlement/refunds, later price-neutral reschedules/extensions at the accepted effective amount, same-type/same-location physical-unit substitution with append-only authority/evidence and deterministic dual-unit serialization including the supported post-amendment baseline, terminal inventory-release cancellation using combined effective-settlement guards, staff-only multi-source partial/full manual/offline booking-price settlement with source-attributed partial/full refunds, centralized tenant-wide manual-reference isolation across all current rental money ledgers, append-only pickup/return custody evidence, post-pickup mutation guards, missed-pickup visibility, overdue open-custody inventory protection with a staff operational queue, explicit whole-day early-return inventory release after return, operational out-of-service state and maintenance work orders, return inspection/damage-case/customer-liability evidence, security-bond requirement/collection/release/exact-forfeiture evidence, versioned unit-type late-return fee policy revisions with non-retroactive fee authority, and explicit late-return assessment with exact manual/offline fee settlement.

Tour and appointment customer booking/payment workflows remain separate later business workflows. Rental now has a staff hold-to-booking interaction, durable booking read model, price-neutral reschedule and custody-extension lifecycle on the current effective unit, one supported same-unit price-changing commercial date-amendment lifecycle with effective post-apply financial authority, supported same-type/same-location physical-unit substitution, explicit inventory-release cancellation, multi-source partial/full manual/offline booking-price settlement with source-attributed partial/full refunds, pickup/return custody recording, missed-pickup and overdue-custody visibility/protection, explicit post-return inventory release, maintenance and operational-serviceability workflows, return inspection/damage/liability handling, security-bond evidence, versioned late-return fee policy authority, and explicit late-return assessment/settlement. Customer booking UI/self-service, unit-type/location-changing or currency-changing commercial changes, a second/chained price-changing amendment and broader repricing, online/card/provider-backed or mixed-provider rental settlement, cancellation fees/automatic cancellation refunds, customer-facing pickup/drop-off/delivery and one-way/opening-hour semantics, automatic damage liability, notifications, and external synchronization remain separate later rental workflow work. Live Prisma/migration/PostgreSQL execution remains governed by the database validation gate above.

## 10. Availability — hospitality allocation foundation implemented

Normalized availability windows, physical capacity, restrictions, temporary holds, expiry semantics, permanent booking allocations, no-overbooking confirmation, canonical room-type allocation locking, and last-unit concurrency coverage are implemented.

Public abandoned `PENDING_CONFIRMATION` allocations stop protecting capacity when their bounded payment-start/recovery evidence expires; staff/non-public pending allocations fail safe.

Rental availability separately excludes explicit blocks, effective holds, non-cancelled durable rental booking allocations, and overdue unreturned physical custody under the physical-unit serialization boundary described in `docs/rental-inventory.md` and `docs/rental-booking-foundation.md`. Rental rescheduling and substitution use the current effective commercial/physical baseline rather than assuming immutable booking-time evidence is still operational authority. Rental cancellation uses the current effective unit lock before changing the booking to terminal `CANCELLED`, after protected combined effective settlement has reconciled to exact zero, after which the retained allocation no longer blocks live availability. A recorded return does not automatically shorten the committed allocation; explicit early-return release may shorten only the live allocation end after immutable return evidence while preserving committed booking/custody history.

## 11. Pricing — hospitality pricing and accepted-state evidence foundation implemented

Exact integer minor-unit money, tenant currency, base-rate windows, percentage/fixed taxes and fees, persisted add-ons, deterministic complete quotes, pricing fingerprints, transactional revalidation, price-change rejection, management UI, and checked-in pricing coverage are implemented.

Newly accepted hospitality commercial states also persist append-only tenant-scoped pricing evidence containing canonical occupied-night, tax/fee, and add-on line details together with exact aggregates, commercial scope, selected add-ons, and the accepted fingerprint. Confirmation, same-price rescheduling, zero-delta commercial modification, and prepared non-zero commercial-amendment targets use this evidence boundary. Historical records are not fabricated by backfilling from current mutable pricing configuration.

Rental holds and durable rental bookings use a separate deterministic daily-rate evidence contract based on integer minor units, immutable hold observations, fresh conversion-time revalidation, and canonical pricing fingerprints. Price-neutral date rescheduling rebuilds current target pricing and permits only unchanged effective currency/exact aggregate amount. One same-unit price-changing rental date amendment is supported through the retained commercial-amendment settlement/apply boundary while immutable `RentalBooking.totalMinor` remains booking-time evidence. Same-type/same-location unit substitution retains current effective dates, accepted effective money, and effective pricing evidence while changing only the physical allocation. Taxes, discounts, deposits, unit-type/location-changing or currency-changing commercial changes, a second/chained price-changing amendment, and broader repricing remain unimplemented until concrete commercial requirements exist.

Future tenant/provider-specific pricing rules should be added only for concrete commercial/provider requirements. The narrow Australian legal-document issuer/tax lifecycle is implemented separately from pricing; broader jurisdiction/tax semantics remain Phase 12 work rather than part of the core pricing model.

## 12. Complete internal and public hospitality booking flow — implemented in code

Authenticated staff booking and the tenant-branded public customer journey both use the same normalized availability, pricing, hold, confirmation, allocation, immutable booking snapshot, and accepted-state pricing-evidence rules.

The public journey is connected end to end: live discovery → hold → current quote → customer/primary guest → capability-owned confirmation → Stripe-hosted Checkout → signed/provider-truth payment recovery. Public callers never receive staff authority, and browser redirects are never payment proof.

The checked-in public PostgreSQL scenarios still require execution against an explicitly confirmed disposable target before that environment gate can be considered validated.

## 13. Payments — substantial production foundation implemented

Implemented:

- normalized provider contract and explicit capabilities
- real manual/offline payment recording
- staff-only rental multi-source partial/full manual/offline booking-price settlement and source-attributed partial/full refund evidence with tenant-scoped append-only persistence, tenant-wide cross-ledger reference isolation, and cancellation financial guards
- rental commercial-amendment exact manual/offline adjustment/compensation evidence plus protected post-apply effective settlement/refunds for the one supported price-changing rental date amendment
- real Stripe authorization/capture and hosted Checkout adapters
- encrypted tenant Stripe configuration through the integration framework
- exact-money transaction ledger and paginated payment history
- tenant-scoped idempotency and pre-provider operation claims
- normalized provider failures and ambiguous-outcome recovery
- raw-body Stripe signature verification and durable webhook-event idempotency
- PaymentIntent, Checkout Session, and refund webhook reconciliation
- provider-truth PaymentIntent/refund polling reconciliation
- partial/full Stripe refunds with safe retry/finalization semantics
- public capability-owned payment status/recovery and Checkout abandonment handling
- read-only payment receipt foundation with exact captured/refunded/net settlement data
- hospitality commercial-amendment manual/Stripe settlement, reconciliation, and compensation recovery
- strict rule that browser redirects never establish payment truth
- Australian hospitality legal-document infrastructure with immutable issuer/recipient/pricing evidence, serializable tax-invoice numbering/issuance, direction-aware cumulative commercial adjustment notes, supported full-cancellation adjustments before and after commercial amendment chains, deterministic PDFs for the current lossless-text contract, tenant registers/accounting CSV, reconciliation, and explicit retention boundaries

Still separate/not claimed complete:

- online/card/provider-backed rental booking-price or amendment settlement, mixed-provider or online split-tender rental settlement, cancellation fees/automatic cancellation refunds, chargebacks, customer self-service rental payments, rental invoices, and rental accounting synchronization; security-bond, damage, and late-return manual evidence remain separate implemented rental ledgers rather than booking-price settlement features
- PayPal or additional payment providers until prioritized by real product need
- mixed-taxability and partial/non-standard-GST adjustment rules
- generic legal-document correction/void/reissue rules
- universal Unicode-safe deterministic PDF rendering
- durable re-authenticated customer legal-document history plus email delivery/resend
- broader booking-linked customer-data disposal/de-identification, provider-held copy handling, and future accounting-provider integration
- complete Node 24/Prisma/PostgreSQL production execution plus jurisdiction/legal review

The legal-document browser cannot select direction, ordinal, predecessor, refund authority, legal money, or numbering. Customer/staff/accounting projections consume shared verified immutable evidence rather than reconstructing historical legal documents from current mutable booking or pricing state. See `docs/invoice-foundation.md`, `docs/rental-payment-foundation.md`, and `docs/customer-data-lifecycle.md`.

## 14. Booking management — current hospitality commercial-amendment scope implemented

Implemented:

- tenant-scoped retrieve/detail view
- paginated payment and audit history
- safe cancellation with payment-state blockers and explicit confirmation
- date-only rescheduling with availability/restriction/current-price revalidation when aggregate money remains unchanged
- traveler snapshot add/edit/remove with occupancy enforcement
- room type, rate plan, room quantity, and add-on changes through zero-delta direct modification or versioned non-zero commercial amendments
- target-room capacity/restriction/occupancy validation and deterministic current/target allocation locking
- target inventory protection for prepared non-zero amendments
- durable commercial-modification/amendment idempotency and stale-retry protection
- unresolved authorization/capture blocking for conflicting date/commercial changes
- manual and Stripe amendment-owned charge/refund execution and provider reconciliation
- signed provider convergence, expiry handling, compensation/recovery, and post-settlement apply-conflict recovery
- serializable final amendment apply that mutates booking/allocation only after provider settlement is ready
- shared booking/payment mutation serialization
- retained commercial history, immutable before/after amendment evidence, and audited mutations

Price-changing **hospitality date** rescheduling remains deliberately separate from the implemented room/rate/quantity/add-on amendment contract. It should only be introduced if product requirements justify extending amendment stay dates, inventory protection, provider settlement, and recovery semantics together rather than treating dates as an unsafe partial edit.

Rental booking management is a separate domain. Rental implements staff confirmation, tenant-scoped history/detail, price-neutral date rescheduling plus a narrow same-unit current-start/later-end custody extension, one supported same-unit price-changing commercial date amendment with preparation, exact manual/offline settlement/compensation, final locked apply and post-apply effective-refund authority, later same-unit price-neutral reschedules/extensions at the accepted effective amount, same-type/same-location physical-unit substitution under deterministic booking/source/target serialization with append-only evidence including the supported post-amendment baseline, terminal inventory-release cancellation against protected combined effective settlement, multi-source partial/full staff-only manual/offline booking-price settlement with source-attributed partial/full refunds, append-only pickup/return custody recording, post-pickup mutation freezes, missed-pickup and overdue-custody protection/queueing, explicit whole-day early-return inventory release, operational availability and maintenance work orders, return inspection/damage/customer-liability evidence, security-bond requirement/collection/release/exact-forfeiture evidence, versioned unit-type late-return policy authority, and explicit late-return assessment plus exact manual/offline fee settlement. Unit-type/location-changing or currency-changing amendments, a second/chained price-changing amendment and broader repricing, online/card/provider-backed or mixed-provider settlement, cancellation fee/automatic refund policy, customer-facing pickup/drop-off/delivery semantics, customer self-service, notifications, and external synchronization remain separate rental contracts rather than being inferred from hospitality behavior.

## 15. Integration framework — current production management foundation implemented

Implemented:

- tenant-owned integration persistence with database ownership constraints
- provider capability registration
- encrypted credential envelopes using a deployment master key
- secret-free management/read models and audits
- add/configure/rotate/enable/disable lifecycle
- administrator-only read-only connection health probes for real adapters
- durable current-credential health status
- safe archive/remove plus fresh-credential reconnection
- normalized provider failure classification
- provider-specific behavior kept behind adapter/configuration boundaries

Additional provider-specific management must only be added alongside a real adapter; unsupported providers must not receive fake controls.

## 16. First external supplier/GDS integration — in progress

Travelport TripServices Stays is selected and implemented behind the normalized supplier boundary for tenant-owned encrypted configuration, authentication/token reuse, health testing, bounded complete SearchComplete property discovery, exact-property offer pricing, exact integer-minor money, mandatory no-cache offer revalidation, normalized v11 full-payload Rules evidence, and a read-only SearchComplete-to-Availability authority bridge for the exact selected offer. Supplier discovery, pricing, revalidation, Rules review, and authority review are server-side only; no external supplier booking action is exposed.

Every Travelport offer remains an observation with no trusted TTL (`validUntil: null`), deterministic normalized commercial fingerprinting, and required revalidation. The Rules adapter performs a fresh adapter-internal SearchComplete bridge for the selected rate, normalizes exact rule evidence, and discards that evidence unless a final no-cache offer revalidation is still unchanged. The first Rules boundary remains deliberately limited to one room and one to nine guests rather than inventing unsupported provider semantics.

The selected-offer create-authority ambiguity is resolved in code without exposing Travelport models to the product domain. The read-only authority adapter repeats fresh Rules/offer review, remaps the selected SearchComplete rate to complete bounded v11 Availability results, requires one exact selected-rate match, and returns only deterministic provider-neutral authority plus the ephemeral provider submission reference required by the server adapter. Request fingerprint v2 binds the reviewed authority to the durable commercial request. The same authority bridge is repeated immediately before any server-only supplier write because cached identifiers are not treated as timeless sell tokens. Live validation of the SearchComplete-to-Availability mapping against a provisioned non-production account remains required before reservation capability can be enabled.

The provider-neutral durable external-write foundation is implemented through tenant-owned supplier reservation operation/attempt persistence. It provides organization-scoped exact idempotency, accepted offer/Rules/reservation-payload/authority fingerprints, exact-money and stay/occupancy evidence, integration credential-version binding, serializable operation claims, database-clock crash-recovery leases, persisted provider/correlation evidence, durable provider-request markers, and fail-closed ambiguity/reconciliation state. Known-locator Travelport Hotel Retrieve is connected to that ledger through a provider-neutral reconciliation coordinator. Booking.com supplier-confirmed/no-PNR evidence can enter the separate durable `RECOVERY_WRITE` Sync path only when the Create response proves the exact supported recovery contract; `13034` by itself is not automatic Sync or retry authority.

The current server-only single-room Create coordinator repeats fresh offer/Rules/Availability/traveler/payment authority, claims a `CREATE` attempt, rechecks the exact integration and credential version, marks the durable provider-request boundary, invokes fixed Travelport Create Reservation, and settles confirmed, failed, ambiguous, or documented price/guarantee review outcomes through the durable ledger. The Booking.com Sync coordinator separately rebinds traveler authority, claims its own recovery-write attempt and provider marker, sends no form-of-payment, and confirms only when the original supplier confirmation and exactly one confirmed Travelport PNR Locator receipt return with the expected reservation identity and no contradictory relevant receipt evidence. These write paths remain product-unreachable while `reservation` is unadvertised.

Documented Travelport price/guarantee no-sell responses persist as dedicated `REVIEW_REQUIRED` state rather than ordinary failure. The tenant-authorized acceptance boundary verifies the exact durable marked/completed Create attempt, explicitly matches the accepted change dimensions, repeats fresh SearchComplete/Rules/Availability/traveler/integration/payment authority, and persists bounded non-secret decision evidence. A separate read-only consumption gate repeats fresh accepted authority immediately before the reviewed second sell.

The one-time accepted-review second-write infrastructure is implemented server-side. Request composition, sensitive-card validation, accepted-query selection, and OAuth finish before a serializable provider-boundary transaction archives the full bounded decision into immutable tenant-scoped acceptance history, binds it to exactly one subsequent `CREATE` attempt, clears the active acceptance slot, and writes `providerRequestStartedAt`. Only after that transaction commits can the executor send the second Create request, and it includes only the exact accepted `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` query parameter. Initial Create continues to send neither flag. A repeated provider price/guarantee change starts a new `REVIEW_REQUIRED` cycle while the prior acceptance remains in history. Other definitive failures after consumption are non-retryable, so normal Create cannot omit or silently reuse the reviewed flags. Normal retry cannot enter this path.

Travelport `reservation` capability remains unadvertised and no staff/customer reserve action should be exposed until the remaining activation gates are satisfied: live SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery verification with provisioned non-production credentials; a reviewed PCI-safe form-of-payment/guarantee source appropriate for the account; verified `13034`/locator-less correlation and retry semantics; and complete provider-truth recovery behavior. Multi-room, modification, and cancellation capabilities must be verified independently rather than inferred from create support.

## 17. Additional providers — later

Add Amadeus, Sabre, additional Travelport products, or other supplier/payment/email/SMS providers only from real product need and refine contracts from actual provider differences rather than hypothetical abstraction.

## 18. Advanced business modules — later workflows

The tenant-owned tour/package and appointment inventory foundations remain infrastructure-only. Rental has progressed further: temporary availability protection, immutable rate evidence, server-side booking conversion authority, staff hold-to-booking confirmation, durable confirmed booking/allocation persistence, tenant-scoped booking history/detail, price-neutral date rescheduling plus narrow same-unit custody extension, one supported same-unit price-changing commercial date amendment with exact manual/offline adjustment evidence and protected effective settlement/refunds, later price-neutral post-amendment reschedules/extensions, same-type/same-location physical-unit substitution with append-only evidence including post-amendment authority, booked-inventory protection, terminal inventory-release cancellation, rental-linked customer retention, multi-source partial/full staff-only manual/offline booking-price settlement with source-attributed partial/full refunds, append-only pickup/return custody evidence, missed-pickup and overdue open-custody inventory protection/queueing, explicit post-return whole-day inventory release, operational availability/maintenance, return inspection/damage/customer-liability evidence, security-bond evidence, versioned unit-type late-return fee policy authority, and explicit late-return assessment with exact manual/offline settlement are implemented. The broad rental workflow remains incomplete until customer booking/self-service surfaces, unit-type/location-changing or currency-changing commercial changes, a second/chained price-changing amendment and broader repricing, online/card/provider-backed or mixed-provider settlement, cancellation fees/automatic refunds, customer-facing pickup/drop-off/delivery and one-way/opening-hour semantics, notifications, and external synchronization receive their own production contracts.

Later work here therefore means tour-operator availability/pricing/passenger/booking flows, appointment slot/exception/intake/booking/calendar flows, the remaining rental commercial/fulfillment workflow, plus hotel/resort extensions, travel-agency workflows, and marketplace capabilities. These must reuse shared foundations only where the commercial concepts genuinely overlap rather than forcing all businesses into one generic booking model.
