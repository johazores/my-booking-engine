import assert from 'node:assert/strict';
import test from 'node:test';
import { isRegistrationEmailConflict } from './auth-conflict-domain.ts';

test('registration classifies only the user email unique constraint as an account conflict', () => {
  for (const error of [
    { code: 'P2002', meta: { modelName: 'User', target: ['email'] } },
    { code: 'P2002', meta: { target: ['email'] } },
    { code: 'P2002', meta: { target: 'users_email_key' } },
  ]) {
    assert.equal(isRegistrationEmailConflict(error), true);
  }

  for (const error of [
    null, undefined, new Error('duplicate'), { code: 'P2002' },
    { code: 'P2002', meta: { target: ['tokenHash'] } },
    { code: 'P2002', meta: { target: ['email', 'id'] } },
    { code: 'P2002', meta: { modelName: 'AuthSession', target: ['email'] } },
    { code: 'P2002', meta: { modelName: 'AuthSession', target: 'users_email_key' } },
    { code: 'P2003', meta: { target: ['email'] } },
    { code: 'P2002', meta: { target: 'auth_sessions_tokenHash_key' } },
  ]) {
    assert.equal(isRegistrationEmailConflict(error), false);
  }
});
