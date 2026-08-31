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

- first-party email/password strategy
- password policy and versioned salted scrypt storage
- persisted opaque sessions
- secure browser session cookie
- sign-up/sign-in/sign-out
- protected server access
- auth error/loading/success states
- unauthorized and expired-session regression coverage

## 4. Organizations and tenant isolation — implemented

- authenticated organization creation/onboarding
- atomic organization + creator-membership persistence
- organization selection for multi-tenant users
- revalidated active-organization server context
- tenant-safe organization/membership reads and writes
- organization settings management
- audited safe organization archival
- cross-tenant repository and mutation coverage checked in

## 5. Roles and permissions — implemented

- platform admin and organization roles
- fine-grained capability model
- reusable server-side permission enforcement
- membership role and lifecycle management
- permission-change auditing
- last-active-admin protection with serializable mutations
- authorization integration coverage checked in

## 6. Persistent application shell — implemented

- canonical authenticated server shell boundary
- shared protected workspace
- persistent desktop sidebar
- product-appropriate mobile navigation
- sticky header with tenant identity and account controls
- active navigation states
- responsive layouts and workspace loading states
- skip navigation, semantic navigation labels, visible focus behavior, and reduced-motion loading
- useful dashboard connected only to real tenant/auth/membership data
- future authenticated modules reuse the canonical workspace rather than create isolated shells

## 7. Tenant settings and white-label branding — implemented configuration foundation

- business name managed by organization settings
- tenant logo and favicon URLs
- primary, secondary, and accent colors
- controlled tenant typography choices
- tenant contact email, phone, and website
- email sender name and reply-to configuration
- public booking title/description persisted behind a public-safe reader
- unique canonical custom-domain model/configuration
- audited, permission-checked branding updates
- CSS design-token propagation across the authenticated workspace
- tenant logo/favicon/business name applied to authenticated shell/metadata
- responsive `/branding` management UI with empty/read-only/error/success states

The real public booking journey and custom-domain DNS ownership/routing are deliberately not claimed here. The branding configuration is ready for those later dependencies without creating a fake booking page or pretending a configured hostname is live.

## 8. Customers/travelers/guests — implemented customer foundation

- tenant-owned `Customer` model and migration
- tenant-local canonical email uniqueness
- `customer:read` / `customer:manage` capabilities
- server-enforced tenant scope on list/detail/create/update/archive
- searchable, filterable, sortable, paginated `/customers` directory
- create customer workflow with validation/conflict handling
- customer detail and edit workflow
- explicit soft archival lifecycle and read-only archived records
- customer activity history backed by safe audit events
- responsive/loading/empty/error/success/accessibility states
- checked-in cross-tenant/customer lifecycle PostgreSQL integration coverage

The customer model is intentionally a stable customer/contact foundation. Traveler/passenger structures that are booking-specific should be added when the real booking flow needs them instead of prematurely forcing every traveler concept into this record.

## 9. Internal inventory — next

Start with one real business capability rather than generic placeholder inventory. Choose the highest-value initial product contract (hospitality, tours, appointments, or rentals) and implement its real data relationships before building availability.

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
