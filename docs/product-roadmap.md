# Product Roadmap

This roadmap follows dependency order. Do not start lower-priority product modules while a required foundation remains incomplete.

## 1. Repository and architecture foundation — implemented

- clean SF reset
- modern runtime/framework baseline
- documentation structure
- responsive public foundation page
- no legacy prototype provider coupling

## 2. Database and tenant foundation — implemented baseline

- PostgreSQL/Prisma setup
- organization model
- user model
- organization membership
- tenant-scoped organization repository

Further tenant enforcement will be wired through protected APIs after authentication exists.

## 3. Authentication — next

- secure sign-in/session persistence/sign-out
- user identity synchronization
- protected server access
- branded SF authentication experience

## 4. Organizations and tenant isolation

- organization selection/context
- tenant-scoped route/application services
- automated isolation tests

## 5. Roles and permissions

- permission model
- organization roles
- protected operations based on permissions, not role names alone

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
