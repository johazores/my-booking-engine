# SF Engineering Instructions

SF is a production booking infrastructure product, not a demo.

Before changing code, read the relevant files in `/docs`, inspect the current schema and implemented workflows, and choose the highest-value incomplete dependency or connected workflow. Do not create placeholder pages or fake product behavior.

## Product rules

- Build a multitenant, white-label, API-driven booking platform.
- Keep a normalized internal booking domain independent from external providers.
- Put GDS, payment, email, SMS, and other external systems behind provider contracts/adapters.
- Model provider capabilities explicitly; do not pretend every provider supports identical operations.
- Support first-party inventory even when no external provider is configured.
- Keep booking state separate from payment state where the business workflow requires it.
- Design booking, payment, refund, provider, and webhook writes for idempotency.
- Design availability so concurrency, holds, capacity, expiry, restrictions, and atomic confirmation can be implemented correctly.
- Enforce organization ownership at the server/database access layer. UI filtering is never tenant security.
- Validate authentication, organization membership, permissions, and resource scope on every protected server operation.
- Encrypt tenant integration credentials before database storage and never log secret values.
- Audit important commercial operations without recording sensitive credentials.
- Treat provider timeouts, auth errors, rate limits, price changes, availability changes, partial failures, and duplicate callbacks as normal failure modes.
- Use structured application logging with safe context such as request ID, organization ID, provider, booking reference, and operation.

## UI/product rules

- Treat SF as one coherent product, not a set of isolated screens.
- Authenticated pages must eventually share a persistent responsive application shell.
- Public booking journeys must connect to real application data.
- No fake analytics, fake confirmation pages, dead primary actions, empty routes, or mock integrations presented as complete.
- Every meaningful async experience must consider initial, loading, empty, error, success, disabled, and validation states.
- Build responsive and accessible interfaces with semantic HTML, labels, keyboard support, visible focus states, logical tab order, and sufficient contrast.

## Engineering rules

- Use kebab-case for project-created files and folders except framework-required filenames.
- Keep documentation inside `/docs`.
- Prefer a modular monolith. Do not add microservices or event-driven architecture without a demonstrated need.
- Keep business logic out of UI components and thin route handlers.
- Prefer correctness, simplicity, maintainability, typing, validation, security, and testability over route/file count.
- Do not add GitHub Actions or CI workflows. Validate locally.
- Keep commits coherent and never commit secrets, local env files, debug files, or generated junk.

## Current technology baseline

- Node.js 24 LTS
- Next.js 16.3.3
- React 19.2.8
- TypeScript 6.0.3
- Prisma ORM 7.10 with `@prisma/adapter-pg`
- PostgreSQL
- Native CSS/design tokens; no UI framework is required for the foundation

TypeScript 7 is newer, but the foundation intentionally stays on the mature TypeScript 6 patch line until the full Next.js/ESLint/Prisma toolchain is verified together.

## Development order

1. repository and architecture foundation
2. database and tenant model
3. authentication
4. organization membership and tenant isolation
5. roles and permissions
6. persistent application shell
7. tenant settings and branding
8. customers
9. internal inventory
10. availability
11. pricing
12. complete internal booking flow
13. payments
14. booking management
15. integration framework
16. first external supplier/GDS integration
17. additional providers
18. advanced business modules

The detailed product architecture and implementation notes live in `/docs`. Documentation must describe what is actually implemented versus what is planned.
