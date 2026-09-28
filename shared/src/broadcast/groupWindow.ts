/**
 * Eastern-time broadcast window for a kickoff (docs/B1-BROADCAST-DESIGN.md §4.1). Used by the
 * carriage window checks here and by the app's board grouping (`app/lib/board.ts`).
 */
import type { WindowLabel } from './types.js';

const ET_TIME_ZONE = 'America/New_York';

/**
 * Broadcast windows are defined in Eastern time no matter where the device is, so a phone in
 * Los Angeles groups Sunday's 1pm ET slate under SUNDAY · EARLY rather than splitting it at
 * 10am local. Displayed kickoff times stay device-local; only the grouping is pinned to ET.
 *
 * Deliberately not `Intl.DateTimeFormat.formatToParts`, which is how `rateLimiter.ts` and
 * `shared/etCalendarDate.ts` read ET on the server: Hermes tags the weekday part `type: 'literal'`
 * instead of `type: 'weekday'`, so a parts lookup finds nothing on device and collapses the whole
 * slate into one unlabelled group. This runs in the app bundle, so it has to read ET this way.
 * `toLocaleDateString` / `toLocaleString` honor `timeZone` identically on Hermes and Node.
 */
function easternWeekdayAndHour(date: Date): { weekday: string; hour: number } {
  const weekday = date.toLocaleDateString('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'long',
  });
  const hour = Number(
    date.toLocaleString('en-US', { timeZone: ET_TIME_ZONE, hour: 'numeric', hour12: false }),
  );
  // Some ICU builds render midnight as "24" under hour12:false — same normalization the
  // dispatcher's quiet-hours check uses.
  return { weekday, hour: Number.isFinite(hour) ? hour % 24 : 0 };
}

export function groupWindow(kickoff: Date): WindowLabel {
  const { weekday, hour } = easternWeekdayAndHour(kickoff);

  switch (weekday) {
    case 'Thursday':
      // Thanksgiving afternoon games are Thursday football without being "Thursday Night".
      return hour >= 19 ? 'THURSDAY NIGHT' : 'THURSDAY';
    case 'Friday':
      return 'FRIDAY';
    case 'Saturday':
      return 'SATURDAY';
    case 'Sunday':
      if (hour < 12) return 'SUNDAY · MORNING';
      if (hour < 16) return 'SUNDAY · EARLY';
      if (hour < 19) return 'SUNDAY · LATE';
      return 'PRIMETIME';
    case 'Monday':
      return 'MONDAY';
    default:
      return weekday.toUpperCase() as WindowLabel;
  }
}
