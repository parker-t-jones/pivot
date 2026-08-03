/**
 * NFL kickoffs are published in Eastern Time. A Thursday/Sunday night 8:20pm ET start is already
 * the *next* calendar day in UTC — extracting the UTC date would report the wrong day (e.g. Sept 10
 * for a Sept 9 kickoff). Always derive the calendar date in America/New_York.
 */
export function etCalendarDateFromUtc(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamptz: ${isoUtc}`);
  }
  return formatEtCalendarDate(date);
}

/** America/New_York calendar date for an arbitrary instant (e.g. "today" for display_phase). */
export function etCalendarDateFromInstant(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new Error('Invalid Date for ET calendar day');
  }
  return formatEtCalendarDate(now);
}

function formatEtCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not format ET calendar date for: ${date.toISOString()}`);
  }
  return `${year}-${month}-${day}`;
}
