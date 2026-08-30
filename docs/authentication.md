# Authentication

## Strategy

SF uses first-party email/password authentication with opaque database-backed sessions. Authentication proves identity only; tenant authorization is still enforced through current organization membership and server-side resource scope.

## Password credentials

- Email identities use the canonical trimmed-lowercase user email rule.
- Passwords are never trimmed or normalized.
- Passwords must contain 12–128 Unicode characters.
- Password hashes use Node.js scrypt with a random 16-byte salt, versioned parameters, and a 64-byte derived key.
- Only encoded password hashes are stored.
- Credential lookup requires an `ACTIVE` user.
- Failed sign-in responses remain generic and do not reveal whether an email exists.

## Sessions

Registration and sign-in create a cryptographically random 32-byte opaque session token. PostgreSQL stores only its SHA-256 digest. Sessions use a 14-day absolute expiry and are valid only while unexpired, non-revoked, and attached to an `ACTIVE` user.

Sign-out revokes the persisted session before expiring the browser cookie. User suspension therefore removes authenticated access on the next protected request.

## Browser HTTP boundary

The browser authentication flow is implemented through App Router POST route handlers:

- `POST /api/auth/sign-up`
- `POST /api/auth/sign-in`
- `POST /api/auth/sign-out`

Successful sign-up and sign-in redirect to `/account` and set the opaque token only in the `sf_session` cookie. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, and expires with the persisted session. The token is never returned in normal JSON, query strings, analytics, or logs.

`/sign-in` and `/sign-up` provide labeled browser forms with native validation and safe error feedback. `/account` is the first protected server-rendered surface: it resolves identity exclusively from the server session cookie, redirects unauthenticated requests to sign-in, and then queries tenant access using the authenticated user ID.

The account page intentionally shows an empty tenant state when the user has no active organization memberships. Authentication never creates or implies organization access; organization onboarding remains Phase 3 work.

## Tenant authorization

Every tenant-owned operation must derive user identity from a validated server session and then enforce current organization membership, permissions, and resource ownership. Client-supplied user IDs are never an authentication boundary.

The protected account organization list currently reuses the tenant-safe organization repository, which requires active organization membership and active principal state. Future protected routes and mutations must follow the same pattern.

## Current implementation status

Implemented:

- production authentication strategy,
- password policy and versioned salted scrypt hashing,
- opaque persisted sessions with token digests only,
- atomic registration persistence,
- sign-in/session resolution/session revocation,
- browser sign-up/sign-in/sign-out route handlers,
- secure cookie delivery and expiration,
- protected server-rendered account guard,
- authenticated identity-to-tenant membership lookup,
- validation/error/success/empty states for the current auth UI,
- dependency-free authentication domain tests,
- PostgreSQL authentication persistence integration coverage in the disposable database runner.

Still pending within the broader roadmap:

- organization onboarding and tenant selection/switching,
- role/permission enforcement beyond active membership scope,
- password reset/recovery and additional security-event workflows,
- live PostgreSQL verification of checked-in migrations in an available disposable database environment.
