/** Only render feedback from a message map's own explicitly defined keys. */
export function readKnownQueryMessage(
  messages: Readonly<Record<string, string>>,
  key: unknown,
): string | undefined {
  if (typeof key !== 'string' || !Object.hasOwn(messages, key)) return undefined;
  const message = messages[key];
  return typeof message === 'string' ? message : undefined;
}
