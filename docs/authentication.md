# Authentication

## Strategy

SF uses first-party email/password authentication with opaque database-backed sessions. Authentication proves identity only; tenant authorization is still enforced through current organization membership and server-side resource scope.

## Password credentials

- Email identities use the canonical trimmed-lowercase user email rule. Control characters, Unicode default-ignorable characters (including invisible joiners, variation selectors, and tag characters), bidi controls, and unpaired Unicode surrogates are rejected before credential admission; ordinary Unicode names remain supported.
- Passwords are never trimmed or normalized. Unpaired UTF-16 surrogates are rejected before hashing or verification, avoiding UTF-8 replacement-character aliases; valid Unicode passwords remain unchanged.
- Passwords must contain 12–128 Unicode characters. Browser `maxLength={256}` is only a UTF-16 input envelope: native HTML length limits count surrogate pairs as two code units, while the server enforces 128 Unicode code points. A valid 128-character supplementary-plane password must not be blocked by the browser. The browser `minLength={12}` can admit some too-short supplementary-plane inputs, which the server rejects.
- Optional registration display names are limited to 160 Unicode code points in the shared server validator, matching PostgreSQL `varchar(160)` semantics. The browser `maxLength={320}` is only a UTF-16 envelope, not permission to persist 320 characters.
- Password hashes use Node.js scrypt with a random 16-byte salt, versioned parameters, and a 64-byte derived key.
- To bound per-process scrypt memory under concurrent sign-in/sign-up traffic, at most two derivations execute at once; up to 16 requests may wait for at most 10 seconds. Overflow fails closed with generic browser feedback, without persisting credentials or sessions. Aborted browser requests are removed from the queue and rechecked before session persistence. Quota admission also checks abort state before and between independent database writes, avoiding unnecessary global quota consumption after an abandoned identity admission; already-started quota writes are not cancelled or refunded. Already-running scrypt cannot be cancelled and already-started database writes are not rolled back by a disconnect. These limits do not replace edge protection or the shared PostgreSQL admission budgets.
- Only encoded password hashes are stored. Verification rejects noncanonical base64url salt/key encodings and noncanonical scrypt parameter strings rather than accepting decoder aliases or corrupted credential records. Unexpected scrypt failures propagate as operational errors rather than being reported as incorrect passwords.
- Credential lookup requires an `ACTIVE` user.
- Failed sign-in responses remain generic and do not reveal whether an email exists.
- Registration treats only a confirmed `users.email` uniqueness failure as an existing-account conflict. Other unique constraint failures in the atomic user/credential/session creation (including session-token collisions) remain operational errors, not mislabeled account conflicts. The browser response stays generic in both cases. A checked-in disposable-database regression verifies duplicate registration creates no extra user or session; this test still requires live execution.

## Sessions

Registration and sign-in create a cryptographically random 32-byte opaque session token. PostgreSQL stores only its SHA-256 digest. Sessions use a 14-day absolute expiry and are valid only while unexpired, non-revoked, and attached to an `ACTIVE` user. Registration and sign-in derive the persisted expiry from PostgreSQL `statement_timestamp()`, and the browser cookie uses that exact persisted expiry. Sign-in session insertion rechecks the current `ACTIVE` user state under a PostgreSQL row lock after password verification, and calculates expiry in that same insert statement. A suspended account therefore cannot receive a newly issued sign-in session through a stale credential read; this does not prevent a suspension immediately after successful sign-in, which session resolution still denies. Session resolution checks expiry and active user state together in one database-clock query; revocation timestamps also use PostgreSQL time. This prevents application-server clock skew from extending or prematurely ending a session. Database clock/read failures deny access rather than falling back to the application clock. Session resolution and revocation first reject malformed, noncanonical, or oversized bearer cookie values without querying PostgreSQL. Only canonical unpadded base64url encodings of 32-byte tokens are accepted.

Sign-out revokes the persisted session before expiring the browser cookie. Successful sign-in and sign-up, and successful sign-out, also expire the previous `sf_organization` preference cookie. This prevents a selected tenant from carrying over between browser identities; the preference is never authorization authority. User suspension therefore removes authenticated access on the next protected request. Expired, revoked, unknown, or otherwise invalid session tokens resolve to no authenticated identity.

## Browser HTTP boundary

The browser authentication flow is implemented through App Router POST route handlers:

- `POST /api/auth/sign-up`
- `POST /api/auth/sign-in`
- `POST /api/auth/sign-out`

Successful sign-up and sign-in redirect to `/account` and set the opaque token only in the `sf_session` cookie. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, and expires with the persisted session. The token is never returned in normal JSON, query strings, analytics, or logs.

All sign-in, sign-up, sign-out, and organization-management POST responses, including redirects and error responses, set `Cache-Control: no-store` so browser/shared caches cannot retain credential transition responses. All authentication mutations reject requests whose `Origin` does not exactly match the request origin. Credential form endpoints accept browser form media types only (`application/x-www-form-urlencoded` and `multipart/form-data`) and return HTTP 415 for unsupported request media types. Malformed accepted form payloads and credential forms exceeding 8 KiB are treated as validation failures instead of reaching credential logic. Both credential routes validate canonical email, password length, and (for registration) optional display name before reserving an authentication attempt, so malformed credential input cannot consume the shared database quota. The services repeat the same shared validation for alternate callers. Invalid identities, invalid-length passwords, and invalid registration names return validation feedback rather than being mislabeled as server failures.

Credential and organization-management browser POST redirects use path-only HTTP 303 `Location` headers. The destination is never built from the inbound request URL or Host header. The shared redirect guard rejects external, network-path, backslash, and control-character destinations. This reduces Host-influenced redirect risk but does not replace trusted proxy Host validation or Origin enforcement. The redirect behavior has dependency-free policy and source-contract regression coverage; the full Next.js runtime still requires local Node 24 validation.

`/sign-in` and `/sign-up` provide labeled browser forms with native validation and safe error feedback. Database-denied rate-limited submissions show a rounded-up wait duration carried through the browser redirect, while the server validates and bounds the display-only query parameter; PostgreSQL remains the only admission authority. Authenticated users who visit either page are redirected back to `/account` rather than being encouraged to create or sign into another identity in the same session. Route-level loading states and the protected account loading state use accessible live/busy semantics and respect reduced-motion preferences.

`/account` is a protected server-rendered surface within the authenticated application shell: it resolves identity exclusively from the server session cookie, redirects requests with no session cookie to sign-in with a normal authentication-required message, and redirects requests carrying an invalid or expired session cookie with an explicit session-expired/invalid message. The redirect decision is centralized in the authentication HTTP policy and regression-tested. The account page then queries tenant access using only the authenticated user ID.

The account page intentionally shows an empty tenant state when the user has no active organization memberships. Authentication never creates or implies access to an existing organization. Authenticated users can create a new organization through the separately authorized onboarding workflow; the creator receives an active `ADMIN` membership atomically with the new tenant.

## Tenant authorization

Every tenant-owned operation must derive user identity from a validated server session and then enforce current organization membership, permissions, and resource ownership. Client-supplied user IDs are never an authentication boundary.

The protected account organization list reuses the tenant-safe organization repository, which requires active organization membership and active principal state. Implemented organization, membership, customer, inventory, booking, payment, and integration operations additionally enforce current capabilities and tenant/resource ownership at their own server boundaries. The shared authenticated shell is presentation and never substitutes for operation-level authorization.

## Verification coverage

Dependency-free authentication domain tests cover password policy, salted/versioned password hashing, token entropy/digest behavior, and absolute session expiry calculation. Authentication HTTP policy tests cover exact same-origin enforcement, accepted credential form media types, unsupported request media types, missing-session redirects, invalid/expired-session redirects, and successful protected-session pass-through.

The disposable PostgreSQL authentication integration test covers registration, credential persistence, database-clock session expiry and cookie-expiry parity, active session resolution, forced session expiry rejection, database-clock revocation, subsequent sign-in, active-user-only session insertion, rejection of new sessions for suspended users, a concurrent uncommitted suspension versus session-insertion row-lock regression, and immediate loss of access when the user is suspended.

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

Implemented in the broader product after the authentication foundation:

- organization onboarding and active-tenant selection/switching;
- organization roles, fine-grained capability checks, and audited membership lifecycle/role management;
- the shared authenticated application shell and operation-level tenant authorization.

Still pending or gated:

- live validation and operational rollout of database-backed 15-minute sign-in/sign-up identity and deployment-wide budgets. The checked-in implementation is described in `docs/authentication-abuse-control.md`. Trusted per-source enforcement, account-enumeration remediation, and deployment-edge controls remain open;
- password reset/recovery and additional security-event workflows, which must not be presented as available;
- live PostgreSQL verification of checked-in migrations in an available disposable database environment.
