// Keep legal-document register navigation within the service's 100,000-page limit.
// Next.js searchParams can contain arrays for repeated query keys.
export function parseHospitalityLegalDocumentPage(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[0-9]{1,6}$/.test(value)) return 1;
  const page = Number(value);
  return page >= 1 && page <= 100_000 ? page : 1;
}
