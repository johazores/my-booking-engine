# Authentication abuse control

The sign-in and sign-up browser POST handlers reserve attempts before password hashing, account lookup, or registration. Reservations use PostgreSQL conflict updates and the database clock, not process-local memory, so all replicas share limits.

Each route has a separate 15-minute fixed-window budget:

| Route | Per canonical email | Deployment-wide |
| --- | ---: | ---: |
| Sign-in | 10 | 5,000 |
| Sign-up | 4 | 1,500 |

Both budgets count requests including successful attempts. Account keys are HMAC-SHA256 digests derived using the separate 32-byte deployment secret `SF_AUTH_ABUSE_SECRET`; only digests, operation, scope, window, and count are persisted. The secret must be canonical unpadded base64url and identical across replicas. Missing/invalid secrets fail closed with a generic error. Rotating the secret resets per-identity windows and must be coordinated across replicas. Old windows are opportunistically pruned after 48 hours.

The database applies `date_bin` with `statement_timestamp()` and a conditional atomic `ON CONFLICT` increment. Concurrent requests cannot exceed the count limit. Denied browser requests redirect to the same form with a generic message and conservative `Retry-After: 900`. Redirects are HTTP 303, not 429, and must not be counted as edge-level HTTP throttling.

## Still open

- No trusted client-source identity is available in the app runtime. Do not trust caller-supplied `X-Forwarded-For`. Verify edge header ownership and add trusted per-source protection independently.
- Global caps can temporarily deny legitimate users during sustained abuse. Monitor privacy-safe operation/outcome counts and tune with real production evidence. This does not replace DDoS/WAF protection.
- Sign-up now maps duplicate-address failures to the same generic browser error as other registration failures. However, successful registration still creates an immediate session, so the success/failure distinction can reveal account existence. Full remediation requires a real email verification/recovery lifecycle, not a fake success response.
- The checked-in migration and integration suite require live Node 24 and disposable PostgreSQL validation before production rollout. The Phase 2 checklist remains open until that evidence and the missing protections exist.

Run `npm run test` and guarded `npm run test:database` with the documented disposable target.
