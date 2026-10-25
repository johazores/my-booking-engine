/**
 * Verify the bounded Stays JSON body is syntactically valid and has an object
 * root before a supplier request can cross the terminal transport boundary.
 * The caller owns the byte limit; never log or retain the parsed payload.
 */
export function isValidTravelportStaysJsonObjectBody(body: string): boolean {
  if (!body.isWellFormed()) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
