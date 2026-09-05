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

## 8. Customers, travelers, and guests — implemented current hospitality foundation

Tenant-owned customer/contact records, lifecycle management, search/filter/sort/pagination, audits, and permissions are implemented. Hospitality bookings persist immutable ordered guest snapshots, and confirmed-booking traveler snapshots can be edited through the tenant-safe booking-management boundary with occupancy and idempotency enforcement.

Archived bookingless customer profiles also support an irreversible tenant-scoped de-identification action that clears mutable direct identifiers only after `customer:manage`, explicit confirmation, and a write-time re-check that no hospitality booking references the profile. Booking-linked customer copies, provider-held data, backups/exports, and legally retained evidence remain separate reviewed lifecycle work.

## 9. Internal inventory — hospitality foundation implemented

Implemented hospitality capabilities include properties, room types, physical rooms, amenities, image records, rate plans, assignments, restrictions, lifecycle guards, permissions, management UI, and tenant-safe database relationships.

Tours, appointments, rentals, and marketplace inventory remain separate later business modules; they are not forced into the hospitality schema.

## 10. Availability — hospitality allocation foundation implemented

Normalized availability windows, physical capacity, restrictions, temporary holds, expiry semantics, permanent booking allocations, no-overbooking confirmation, canonical room-type allocation locking, and last-unit concurrency coverage are implemented.

Public abandoned `PENDING_CONFIRMATION` allocations stop protecting capacity when their bounded payment-start/recovery evidence expires; staff/non-public pending allocations fail safe.

## 11. Pricing — hospitality pricing and accepted-state evidence foundation implemented

Exact integer minor-unit money, tenant currency, base-rate windows, percentage/fixed taxes and fees, persisted add-ons, deterministic complete quotes, pricing fingerprints, transactional revalidation, price-change rejection, management UI, and checked-in pricing coverage are implemented.

Newly accepted hospitality commercial states also persist append-only tenant-scoped pricing evidence containing canonical occupied-night, tax/fee, and add-on line details together with exact aggregates, commercial scope, selected add-ons, and the accepted fingerprint. Confirmation, same-price rescheduling, zero-delta commercial modification, and prepared non-zero commercial-amendment targets use this evidence boundary. Historical records are not fabricated by backfilling from current mutable pricing configuration.

Future tenant/provider-specific pricing rules should be added only for concrete commercial/provider requirements. Jurisdiction-specific legal issuer/tax semantics remain a separate invoice dependency.

## 12. Complete internal and public hospitality booking flow — implemented in code

Authenticated staff booking and the tenant-branded public customer journey both use the same normalized availability, pricing, hold, confirmation, allocation, immutable booking snapshot, and accepted-state pricing-evidence rules.

The public journey is connected end to end: live discovery → hold → current quote → customer/primary guest → capability-owned confirmation → Stripe-hosted Checkout → signed/provider-truth payment recovery. Public callers never receive staff authority, and browser redirects are never payment proof.

The checked-in public PostgreSQL scenarios still require execution against an explicitly confirmed disposable target before that environment gate can be considered validated.

## 13. Payments — substantial production foundation implemented

Implemented:

- normalized provider contract and explicit capabilities
- real manual/offline payment recording
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
- commercial-amendment manual/Stripe settlement, reconciliation, and compensation recovery
- strict rule that browser redirects never establish payment truth
- Australian hospitality legal-document infrastructure with immutable issuer/recipient/pricing evidence, serializable tax-invoice numbering/issuance, direction-aware cumulative commercial adjustment notes, supported full-cancellation adjustments before and after commercial amendment chains, deterministic PDFs for the current lossless-text contract, tenant registers/accounting CSV, reconciliation, and explicit retention boundaries

Still separate/not claimed complete:

- PayPal or additional payment providers until prioritized by real product need
- mixed-taxability and partial/non-standard-GST adjustment rules
- generic legal-document correction/void/reissue rules
- universal Unicode-safe deterministic PDF rendering
- durable re-authenticated customer legal-document history plus email delivery/resend
- broader booking-linked customer-data disposal/de-identification, provider-held copy handling, and future accounting-provider integration
- complete Node 24/Prisma/PostgreSQL production execution plus jurisdiction/legal review

The legal-document browser cannot select direction, ordinal, predecessor, refund authority, legal money, or numbering. Customer/staff/accounting projections consume shared verified immutable evidence rather than reconstructing historical legal documents from current mutable booking or pricing state. See `docs/invoice-foundation.md` and `docs/customer-data-lifecycle.md`.

## 14. Booking management — current commercial-amendment scope implemented

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

Price-changing **date** rescheduling remains deliberately separate from the implemented room/rate/quantity/add-on amendment contract. It should only be introduced if product requirements justify extending amendment stay dates, inventory protection, provider settlement, and recovery semantics together rather than treating dates as an unsafe partial edit.

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

Travelport TripServices Stays is selected and implemented behind the normalized supplier boundary for tenant-owned encrypted configuration, authentication/token reuse, health testing, bounded complete SearchComplete property discovery, exact-property offer pricing, exact integer-minor money, mandatory no-cache offer revalidation, normalized v11 full-payload Rules evidence, and read-only known-locator reservation recovery. Supplier discovery, pricing, revalidation, Rules review, and recovery are server-side only; no external supplier booking action is exposed.

Every Travelport offer remains an observation with no trusted TTL (`validUntil: null`), deterministic normalized commercial fingerprinting, and required revalidation. The Rules adapter performs a fresh adapter-internal SearchComplete bridge for the selected rate, normalizes exact rule evidence, and discards that evidence unless a final no-cache offer revalidation is still unchanged. The first Rules boundary remains deliberately limited to one room and one to nine guests rather than inventing unsupported provider semantics.

The provider-neutral durable external-write foundation is implemented through tenant-owned supplier reservation operation/attempt persistence. It provides organization-scoped exact idempotency, accepted offer/Rules/reservation-payload fingerprints, exact-money and stay/occupancy evidence, integration credential-version binding, serializable operation claims, persisted provider references/correlation evidence, and a fail-closed `AMBIGUOUS -> RECONCILING` recovery state that forbids blind duplicate creates. The new Travelport recovery adapter can verify provider truth only when an authoritative aggregator locator is already known, using the documented Hotel Retrieve endpoint and exact locator matching.

Fresh provider-documentation review found that Travelport's SearchComplete reference-create authority is documented specifically from `propertyItems/lowestPublicAvailableRate/rateKey/value`, while SF supports selecting normalized room/rate offers beyond only that lowest public rate. The next dependency is therefore to establish the exact documented/verified create authority for the selected SF offer before implementing a Travelport reservation POST. An arbitrary selected room-rate key must not be assumed to be a valid `CatalogOfferingIdentifier`.

Travelport `reservation` capability remains unadvertised and no staff/customer reserve action should be exposed until the create bridge, write-outcome classification, payment/guarantee boundary, explicit price/guarantee-change decisions, and locator-less ambiguous-write recovery are validated against a provisioned non-production account. Multi-room, modify, and cancel capability must be verified independently rather than inferred from the single-room Rules boundary.

## 17. Additional providers — later

Add Amadeus, Sabre, Travelport, or other supplier/payment/email/SMS providers only from real product need and refine contracts from actual provider differences rather than hypothetical abstraction.

## 18. Advanced business modules — later

Add hotel/resort extensions, travel-agency workflows, tour-operator workflows, appointments, rentals, and marketplace capabilities only after the shared booking foundation and required provider contracts are proven.
