# Product Roadmap

This roadmap follows dependency order. Finish the highest-priority dependency first, but once a dependency cluster is complete an engineering run should continue into the next safe dependency when capacity remains rather than stopping artificially.

## 1. Repository and architecture foundation — implemented

- clean SF reset
- modern runtime/framework baseline
- documentation structure
- responsive public foundation page
- no legacy prototype provider coupling

## 2. Database and tenant foundation — implemented baseline, live PostgreSQL verification pending

- PostgreSQL/Prisma setup
- organization model
- user model
- organization membership
- tenant-scoped repositories/services
- checked-in migrations and disposable-database verification harness
- checked-in tenant-isolation integration coverage

Live migration/schema/isolation execution still requires an available disposable PostgreSQL target.

## 3. Authentication — implemented

First-party email/password authentication, persisted opaque sessions, secure cookies, protected server access, and auth regression coverage are implemented.

## 4. Organizations and tenant isolation — implemented

Organization onboarding/selection/settings/archive and tenant-safe organization/membership reads and writes are implemented.

## 5. Roles and permissions — implemented

Platform/organization roles, fine-grained capabilities, permission enforcement, membership lifecycle management, audits, and authorization coverage are implemented.

## 6. Persistent application shell — implemented

The canonical protected workspace, responsive navigation/header, tenant identity, account controls, active states, accessibility, and real tenant/auth dashboard are implemented.

## 7. Tenant settings and white-label branding — implemented configuration foundation

Tenant presentation/contact/public-booking configuration, custom-domain configuration, audited branding management, design-token propagation, and a public-safe branding reader are implemented. Real public booking application and domain routing remain later dependencies.

## 8. Customers/travelers/guests — implemented customer foundation

Tenant-owned customer/contact records, permissions, search/filter/sort/pagination, create/detail/edit/archive, audits, responsive states, and PostgreSQL isolation/lifecycle coverage are implemented. Booking-specific traveler/passenger structures remain deferred until the booking flow requires them.

## 9. Internal inventory — hospitality foundation in progress

Implemented hospitality foundation:

- properties
- room types
- physical rooms
- reusable tenant-owned amenities
- property and room-type amenity assignment/removal
- property and room-type hosted-image galleries
- validated HTTPS media references with required alt text and display ordering
- transactional primary-image selection with automatic first-image primary behavior
- tenant-scoped `inventory:read` / `inventory:manage` permissions
- composite parent/tenant database constraints
- bounded pagination on current large collections
- dependency-safe/read-only lifecycle behavior and audit events
- authenticated responsive inventory UI
- checked-in cross-tenant PostgreSQL integration coverage

Image management intentionally accepts real HTTPS assets from an existing CDN/media host rather than presenting a fake upload integration. A future file-upload capability must sit behind a real storage-provider adapter and should feed the same normalized image records.

Next hospitality dependencies are rate plans and restrictions. Tours, appointments, and rentals remain intentionally separate business modules; do not force them into the hospitality model.

## 10. Availability

Concurrency-safe availability, holds, expiry, restrictions, and capacity.

## 11. Pricing

## 12. Complete internal booking flow

Search → availability → selection → pricing validation → customer details → booking → confirmation.

## 13. Payments

Provider contract, first payment implementation, webhooks, idempotency, refunds, and reconciliation references.

## 14. Booking management

Retrieve, modify/reschedule, cancel, refund, history, and audit trail.

## 15. Integration framework

Database-managed encrypted credentials, capability registration, status, connection testing, and provider administration.

## 16. First external supplier/GDS integration

Research current provider workflow and implement one real end-to-end provider slice.

## 17. Additional providers

Refine abstractions based on real provider differences.

## 18. Advanced business modules

Add business-specific capabilities only after the shared platform foundations are proven.
