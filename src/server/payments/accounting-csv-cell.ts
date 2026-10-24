/** Quote a CSV cell and keep spreadsheet applications from executing text as formulas. */
export function accountingCsvCell(value: string) {
  // CSV quoting alone does not stop spreadsheet formula evaluation.
  // Keep trusted decimal-money columns numeric; prefix only formula-like text.
  const literal = /^[\s\uFEFF\u200B]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
}
