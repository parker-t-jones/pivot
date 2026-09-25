/**
 * Eastern-time broadcast window for a kickoff (docs/B1-BROADCAST-DESIGN.md §4.1;
 * mirrors `app/lib/board.ts` `groupWindow` for carriage window checks).
 */
import type { WindowLabel } from './types.js';

const ET_TIME_ZONE = 'America/New_York';

function easternWeekdayAndHour(date: Date): { weekday: string; hour: number } {
  const weekday = date.toLocaleDateString('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'long',
  });
  const hour = Number(
    date.toLocaleString('en-US', { timeZone: ET_TIME_ZONE, hour: 'numeric', hour12: false }),
  );
  return { weekday, hour: Number.isFinite(hour) ? hour % 24 : 0 };
}

export function groupWindow(kickoff: Date): WindowLabel {
  const { weekday, hour } = easternWeekdayAndHour(kickoff);

  switch (weekday) {
    case 'Thursday':
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
