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

## 9. Internal inventory — hospitality foundation implemented

Implemented hospitality capabilities include properties, room types, physical rooms, amenities, image records, rate plans, assignments, restrictions, lifecycle guards, permissions, management UI, and tenant-safe database relationships.

Tours, appointments, rentals, and marketplace inventory remain separate later business modules; they are not forced into the hospitality schema.

## 10. Availability — hospitality allocation foundation implemented

Normalized availability windows, physical capacity, restrictions, temporary holds, expiry semantics, permanent booking allocations, no-overbooking confirmation, canonical room-type allocation locking, and last-unit concurrency coverage are implemented.

Public abandoned `PENDING_CONFIRMATION` allocations stop protecting capacity when their bounded payment-start/recovery evidence expires; staff/non-public pending allocations fail safe.

## 11. Pricing — hospitality pricing foundation implemented

Exact integer minor-unit money, tenant currency, base-rate windows, percentage/fixed taxes and fees, persisted add-ons, deterministic complete quotes, pricing fingerprints, transactional revalidation, price-change rejection, management UI, and checked-in integration coverage are implemented.

Future tenant/provider-specific pricing rules should be added only for concrete commercial/provider requirements.

## 12. Complete internal and public hospitality booking flow — implemented in code

Authenticated staff booking and the tenant-branded public customer journey both use the same normalized availability, pricing, hold, confirmation, allocation, and immutable booking snapshot rules.

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
- strict rule that browser redirects never establish payment truth

Still separate/not claimed complete:

- PayPal or additional payment providers until prioritized by real product need
- jurisdiction-specific tax invoice issuance, invoice numbering/tax fields, PDF/email delivery, and accounting integrations

## 14. Booking management — zero-delta commercial changes implemented; price-changing adjustment contract remains

Implemented:

- tenant-scoped retrieve/detail view
- paginated payment and audit history
- safe cancellation with payment-state blockers and explicit confirmation
- date-only rescheduling with availability/restriction/current-price revalidation
- traveler snapshot add/edit/remove with occupancy enforcement
- room type, rate plan, room quantity, and add-on changes when every monetary price component remains exactly unchanged
- target-room capacity/restriction/occupancy validation and deterministic current/target allocation locking
- durable commercial-modification idempotency and stale-retry protection
- unresolved authorization/capture blocking for commercial changes
- shared booking/payment mutation serialization
- retained commercial history and audited mutations

Remaining major boundary: any room, rate, quantity, add-on, date, or other commercial modification that produces a non-zero price delta. That requires an explicit versioned amendment/payment-adjustment contract covering charge/refund intent, provider behavior, payment-state transitions, immutable before/after history, retries, failure/ambiguity recovery, and customer/staff presentation. SF does not silently mutate amount owed or paid.

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

## 16. First external supplier/GDS integration — not started

Before implementation, research the current provider architecture/API, select one provider based on product value and obtainable access, and implement only its real capabilities behind the normalized supplier contract. Required work includes authentication/token handling, normalized search/availability/pricing, reservation lifecycle where supported, rate-limit/timeout/auth/unavailable handling, correlation/idempotency, and integration coverage.

## 17. Additional providers — later

Add Amadeus, Sabre, Travelport, or other supplier/payment/email/SMS providers only from real product need and refine contracts from actual provider differences rather than hypothetical abstraction.

## 18. Advanced business modules — later

Add hotel/resort extensions, travel-agency workflows, tour-operator workflows, appointments, rentals, and marketplace capabilities only after the shared booking foundation and required provider contracts are proven.
