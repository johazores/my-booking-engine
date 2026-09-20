# Rental damage assessment historical replay

SF treats a retained rental damage assessment as immutable operational evidence. An exact retry of the assessment write must remain idempotent even after the damage case later moves from `ASSESSED` to terminal `WAIVED` or `CLOSED`.

## Replay authority

`assessRentalDamageCase` still acquires the authenticated tenant physical-unit lock and reloads the same tenant booking/case/unit evidence before deciding whether the request is fresh or a replay.

For an `OPEN` case, no assessment exists yet, so the normal `OPEN -> ASSESSED` lifecycle transition remains required.

For `ASSESSED`, `WAIVED`, or `CLOSED`, the service may return the retained case as an idempotent success only when both immutable assessment fields exactly match the normalized retry:

- `estimatedRepairCostMinor`; and
- `assessmentNotes`.

A mismatch fails closed. The replay does not change case status, reopen a terminal case, rewrite assessment evidence, update the assessment actor/time, or append another audit event.

A case waived directly from `OPEN` has no retained assessment evidence. It therefore cannot use historical assessment replay to create assessment authority after the terminal waiver; the normal lifecycle guard still rejects `WAIVED -> ASSESSED`.

## Similar-workflow review

The same-scope replay review confirmed that damage-case opening already resolves its deterministic retained open evidence before fresh source checks, terminal waiver/closure are idempotent in their terminal states, return inspection is single immutable evidence, late-return assessment is single immutable evidence, and damage-liability/settlement writers already resolve their retained idempotency evidence without reopening operational lifecycle state.

This change is intentionally narrow. It does not add a new damage-case state, payment authority, automatic liability, security-bond disposition, repair workflow, or customer-facing behavior.

## Validation

`src/server/bookings/rental-damage-assessment-replay.test.ts` covers fresh, exact terminal replay, mismatch, and direct-open-waiver behavior.

`scripts/rental-damage-assessment-replay-source-contract.test.mjs` protects service wiring order: retained replay is classified before the fresh lifecycle transition is attempted, while conflicting retained assessment evidence still fails closed.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Live database behavior remains part of the guarded disposable PostgreSQL validation path. GitHub Actions are not required or used.
