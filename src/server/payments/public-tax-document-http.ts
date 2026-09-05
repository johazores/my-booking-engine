export async function readPublicTaxDocumentBookingCapability(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const bookingCapability = (body as { bookingCapability?: unknown }).bookingCapability;
    return typeof bookingCapability === 'string' ? bookingCapability : null;
  } catch {
    return null;
  }
}
