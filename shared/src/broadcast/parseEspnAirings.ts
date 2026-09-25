import { mapMediaName } from './mapMediaName.js';
import type {
  AiringMarket,
  EspnBroadcastEvent,
  ParsedAiring,
  UnmappedMediaLog,
} from './types.js';

function normalizeMarket(raw: string | undefined): AiringMarket {
  if (raw === undefined) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'national') return 'national';
  if (lower === 'regional') return 'regional';
  return 'unknown';
}

/**
 * Parse one ESPN scoreboard event into airing rows (§3.1–3.3).
 * Prefers geoBroadcasts; falls back to broadcasts[].names[].
 * Never parses the singular `broadcast` string (collapses simulcasts).
 */
export function parseEspnAirings(
  event: EspnBroadcastEvent,
  log: UnmappedMediaLog,
): ParsedAiring[] {
  const competition = event.competitions?.[0];
  if (!competition) return [];

  const geos = competition.geoBroadcasts;
  if (geos && geos.length > 0) {
    const rows: ParsedAiring[] = [];
    for (const geo of geos) {
      const rawName = geo.media?.shortName;
      if (rawName === undefined || rawName === '') continue;
      const network = mapMediaName(rawName);
      if (network === null) {
        log({
          eventId: event.id,
          shortName: event.shortName,
          rawName,
          source: 'geoBroadcasts',
        });
        continue;
      }
      rows.push({
        network,
        market: normalizeMarket(geo.market?.type),
        espnMediaName: rawName,
        espnType: geo.type?.shortName ?? null,
      });
    }
    return rows;
  }

  const broadcasts = competition.broadcasts;
  if (!broadcasts || broadcasts.length === 0) return [];

  const rows: ParsedAiring[] = [];
  for (const broadcast of broadcasts) {
    const market = normalizeMarket(broadcast.market);
    for (const rawName of broadcast.names ?? []) {
      const network = mapMediaName(rawName);
      if (network === null) {
        log({
          eventId: event.id,
          shortName: event.shortName,
          rawName,
          source: 'broadcasts',
        });
        continue;
      }
      rows.push({
        network,
        market,
        espnMediaName: rawName,
        espnType: null,
      });
    }
  }
  return rows;
}
