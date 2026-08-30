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

## 4. Organizations and tenant isolation — in progress

Implemented:

- authenticated organization creation/onboarding
- atomic organization + creator-membership persistence
- organization selection for multi-tenant users
- revalidated active-organization server context
- tenant-safe organization/membership reads
- cross-tenant repository coverage checked in

Next dependency work:

- granular roles and permissions before organization-management mutations
- organization settings/deactivation workflows after authorization exists
- route/mutation authorization coverage as those operations are introduced

## 5. Roles and permissions — next

- permission model
- organization roles
- protected operations based on permissions, not role names alone
- membership/role management and authorization tests

## 6. Persistent application shell

- desktop navigation/sidebar
- mobile navigation
- account controls
- organization identity
- honest operational dashboard states

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
