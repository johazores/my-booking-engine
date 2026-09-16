export const RENTAL_BOOKING_HISTORY_PAGE_SIZE = 100;
export const RENTAL_BOOKING_HISTORY_MAX_ROWS = 1_000;

const MAX_HISTORY_PAGES = RENTAL_BOOKING_HISTORY_MAX_ROWS / RENTAL_BOOKING_HISTORY_PAGE_SIZE;

type RentalBookingHistoryRow = Readonly<{ id: string }>;

type RentalBookingHistoryResult<Row extends RentalBookingHistoryRow> = Readonly<
  | { complete: true; rows: readonly Row[] }
  | { complete: false; reason: string }
>;

export async function readBoundedRentalBookingHistory<Row extends RentalBookingHistoryRow>(input: Readonly<{
  label: string;
  readPage: (cursorId: string | undefined, take: number) => Promise<readonly Row[]>;
}>): Promise<RentalBookingHistoryResult<Row>> {
  const rows: Row[] = [];
  let cursorId: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_HISTORY_PAGES; pageIndex += 1) {
    const page = await input.readPage(cursorId, RENTAL_BOOKING_HISTORY_PAGE_SIZE);
    if (page.length > RENTAL_BOOKING_HISTORY_PAGE_SIZE) {
      return Object.freeze({
        complete: false as const,
        reason: `${input.label} returned more than the requested bounded page size.`,
      });
    }

    rows.push(...page);
    if (page.length < RENTAL_BOOKING_HISTORY_PAGE_SIZE) {
      return Object.freeze({ complete: true as const, rows: Object.freeze(rows) });
    }

    cursorId = page.at(-1)?.id;
    if (!cursorId) {
      return Object.freeze({
        complete: false as const,
        reason: `${input.label} could not establish a bounded history cursor.`,
      });
    }
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: `${input.label} could not establish a bounded history cursor.`,
    });
  }

  const overflow = await input.readPage(cursorId, 1);
  if (overflow.length > 0) {
    return Object.freeze({
      complete: false as const,
      reason: `${input.label} exceeds the ${RENTAL_BOOKING_HISTORY_MAX_ROWS}-row history safety limit.`,
    });
  }

  return Object.freeze({ complete: true as const, rows: Object.freeze(rows) });
}
