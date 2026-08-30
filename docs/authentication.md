# Authentication

## Strategy

SF uses first-party email/password authentication with opaque database-backed sessions.

This keeps authentication server-side, avoids storing authorization claims in long-lived browser tokens, and lets user suspension or session revocation take effect on the next protected request. Tenant authorization is deliberately not embedded in the session: authenticated operations must still check current organization membership, permissions, and resource ownership through the server-side tenant boundary.

## Password credentials

- Email identities use the existing canonical trimmed-lowercase user email rule.
- Passwords are never trimmed or normalized.
- Passwords must contain 12–128 Unicode characters.
- Password hashes use Node.js scrypt with a random 16-byte salt, versioned parameters, and a 64-byte derived key.
- Only the encoded password hash is stored in `password_credentials`.
- Credential lookup requires an `ACTIVE` user; suspended or archived users cannot authenticate.
- Failed sign-in responses must remain generic and must not reveal whether an email address exists.

The password hash format is versioned so parameters or algorithms can be migrated later without changing the authentication API contract.

## Sessions

Successful registration or sign-in creates a cryptographically random 32-byte opaque session token. The raw token is returned only to the server-side HTTP layer for delivery in an HttpOnly cookie. PostgreSQL stores only a SHA-256 digest of that token.

Sessions currently use a 14-day absolute expiry. A session is valid only when:

- the token digest exists,
- `revokedAt` is null,
- `expiresAt` is still in the future, and
- the related user remains `ACTIVE`.

Sign-out revokes the stored session rather than trusting browser cookie deletion alone. Future password reset, security-event, or administrator workflows may revoke all sessions for a user.

## Browser cookie requirements

The HTTP layer that exposes sign-in/sign-up must use a cookie with these properties:

- `HttpOnly`
- `Secure` in production
- `SameSite=Lax`
- `Path=/`
- expiry aligned with the persisted session expiry

The session token must never be returned in normal JSON payloads, logs, analytics, URLs, or audit records.

## Tenant authorization

Authentication proves the user identity only. It does not grant access to an organization.

Every tenant-owned protected operation must derive the user ID from the validated server session and then enforce current organization membership, permission, and resource scope. Client-supplied user IDs are never an authentication boundary. This preserves immediate access removal when a user, membership, or organization is suspended.

## Current implementation status

Implemented in the authentication foundation:

- password policy and password hashing domain functions,
- secure random session-token generation and token hashing,
- `PasswordCredential` and `AuthSession` Prisma models,
- registration persistence that creates user, credential, and first session atomically through one nested database write,
- credential lookup restricted to active users,
- sign-in session creation,
- active session resolution,
- idempotent session revocation,
- dependency-free domain tests for password and session primitives.

The checked-in authentication migration remains unverified against live PostgreSQL until the disposable database validation environment is available. Browser routes/forms and cookie delivery are the next authentication slice; this document does not claim those UI/HTTP flows are complete yet.
