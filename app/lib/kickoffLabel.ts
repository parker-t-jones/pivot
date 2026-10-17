import { formatCountdown } from './homeState';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EASTERN = 'America/New_York';

/**
 * Text after "NEXT KICKOFF". More than a day out is the weekday and time in
 * Eastern. Inside a day, and after kickoff, the existing countdown stays.
 */
export function kickoffLabel(kickoff: Date, now: Date): string {
  const ms = kickoff.getTime() - now.getTime();
  if (!(ms > DAY_MS)) return formatCountdown(Math.max(0, ms));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    weekday: 'short',
  })
    .format(kickoff)
    .toUpperCase();
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(kickoff)
    .toUpperCase();
  return `${weekday} ${time}`;
}
