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

Sign-out revokes the persisted session before expiring the browser cookie. User suspension therefore removes authenticated access on the next protected request. Expired, revoked, unknown, or otherwise invalid session tokens resolve to no authenticated identity.

## Browser HTTP boundary

The browser authentication flow is implemented through App Router POST route handlers:

- `POST /api/auth/sign-up`
- `POST /api/auth/sign-in`
- `POST /api/auth/sign-out`

Successful sign-up and sign-in redirect to `/account` and set the opaque token only in the `sf_session` cookie. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, and expires with the persisted session. The token is never returned in normal JSON, query strings, analytics, or logs.

All authentication mutations reject requests whose `Origin` does not exactly match the request origin. Credential form endpoints accept browser form media types only (`application/x-www-form-urlencoded` and `multipart/form-data`) and return HTTP 415 for unsupported request media types. Malformed accepted form payloads are treated as validation failures instead of reaching credential logic.

`/sign-in` and `/sign-up` provide labeled browser forms with native validation and safe error feedback. Authenticated users who visit either page are redirected back to `/account` rather than being encouraged to create or sign into another identity in the same session. Route-level loading states and the protected account loading state use accessible live/busy semantics and respect reduced-motion preferences.

`/account` is the first protected server-rendered surface: it resolves identity exclusively from the server session cookie, redirects requests with no session cookie to sign-in with a normal authentication-required message, and redirects requests carrying an invalid or expired session cookie with an explicit session-expired/invalid message. The redirect decision is centralized in the authentication HTTP policy and regression-tested. The account page then queries tenant access using only the authenticated user ID.

The account page intentionally shows an empty tenant state when the user has no active organization memberships. Authentication never creates or implies organization access; organization onboarding remains Phase 3 work.

## Tenant authorization

Every tenant-owned operation must derive user identity from a validated server session and then enforce current organization membership, permissions, and resource ownership. Client-supplied user IDs are never an authentication boundary.

The protected account organization list currently reuses the tenant-safe organization repository, which requires active organization membership and active principal state. Future protected routes and mutations must follow the same pattern.

## Verification coverage

Dependency-free authentication domain tests cover password policy, salted/versioned password hashing, token entropy/digest behavior, and absolute session expiry calculation. Authentication HTTP policy tests cover exact same-origin enforcement, accepted credential form media types, unsupported request media types, missing-session redirects, invalid/expired-session redirects, and successful protected-session pass-through.

The disposable PostgreSQL authentication integration test covers registration, credential persistence, active session resolution, forced session expiry rejection, persisted revocation, subsequent sign-in, and immediate loss of access when the user is suspended.

The full database-backed integration path still requires the explicitly acknowledged disposable PostgreSQL target described in the database development documentation; blocked environments must not claim that live verification passed.

## Current implementation status

Implemented:

- production authentication strategy,
- password policy and versioned salted scrypt hashing,
- opaque persisted sessions with token digests only,
- atomic registration persistence,
- sign-in/session resolution/session revocation,
- browser sign-up/sign-in/sign-out route handlers,
- same-origin protection on authentication mutations,
- credential endpoint media-type validation,
- malformed form handling before credential logic,
- secure cookie delivery and expiration,
- protected server-rendered account guard,
- explicit missing-session versus invalid/expired-session browser feedback,
- authenticated-page redirect behavior for existing sessions,
- authenticated identity-to-tenant membership lookup,
- validation/error/loading/success/empty states for the current auth UI,
- reduced-motion-safe loading treatment,
- dependency-free authentication domain and HTTP policy tests,
- PostgreSQL authentication persistence integration coverage including forced expiry and revocation.

Still pending within the broader roadmap:

- organization onboarding and tenant selection/switching,
- role/permission enforcement beyond active membership scope,
- password reset/recovery and additional security-event workflows,
- live PostgreSQL verification of checked-in migrations in an available disposable database environment.
