/** Only a duplicate user email is an expected registration conflict.
 * A nested credential/session uniqueness failure must remain an operational error.
 */
export function isRegistrationEmailConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') return false;
  const meta = 'meta' in error ? error.meta : undefined;
  if (!meta || typeof meta !== 'object') return false;
  const modelName = 'modelName' in meta ? meta.modelName : undefined;
  if (modelName !== undefined && modelName !== 'User') return false;
  const target = 'target' in meta ? meta.target : undefined;
  return (Array.isArray(target) && target.length === 1 && target[0] === 'email') ||
    target === 'users_email_key';
}
