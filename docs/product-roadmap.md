# Product Roadmap

This roadmap follows dependency order. Do not start lower-priority product modules while a required foundation remains incomplete.

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
- tenant-scoped organization and membership repositories
- checked-in migrations and disposable-database verification harness

Live migration/schema/isolation verification still requires an available disposable PostgreSQL target.

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

## 6. Persistent application shell — in progress

Implemented:

- authenticated `/dashboard` workspace foundation
- persistent desktop sidebar for implemented workspace routes
- product-appropriate mobile navigation
- sticky header with tenant identity and account controls
- active navigation states
- responsive layouts and loading state
- skip navigation, semantic navigation labels, visible focus behavior, and reduced-motion loading
- useful dashboard connected only to real tenant/auth/membership data

Remaining integration work:

- migrate existing account/organization administration into the canonical workspace when it can be done without risking completed auth/organization workflows
- keep future authenticated modules under the dashboard workspace instead of creating isolated shells

## 7. Tenant settings and white-label branding

## 8. Customers/travelers/guests

## 9. Internal inventory

Start with one real business capability rather than generic placeholder inventory.

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
