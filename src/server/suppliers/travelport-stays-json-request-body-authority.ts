/**
 * Verify the bounded Stays JSON body is syntactically valid, object-rooted,
 * and contains well-formed Unicode even after JSON escape decoding.
 * The caller owns the byte limit; never log or retain the parsed payload.
 */
export function isValidTravelportStaysJsonObjectBody(body: string): boolean {
  if (!body.isWellFormed()) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

    // JSON.parse produces a finite acyclic tree. Iterative traversal avoids
    // call-stack exhaustion on deeply nested supplier request objects.
    const pending: unknown[] = [parsed];
    while (pending.length > 0) {
      const current = pending.pop();
      if (typeof current === 'string') {
        if (!current.isWellFormed()) return false;
      } else if (Array.isArray(current)) {
        for (const value of current) pending.push(value);
      } else if (current !== null && typeof current === 'object') {
        for (const [key, value] of Object.entries(current)) {
          if (!key.isWellFormed()) return false;
          pending.push(value);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
