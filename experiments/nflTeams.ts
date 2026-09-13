/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * Team nicknames and colors keyed by abbreviation, for seeding the dispatcher's `InMemoryGameCatalog`
 * during the live test.
 *
 * These live here rather than being pulled from ESPN because `espnSummarySchema` validates only
 * `team.abbreviation` — nicknames and colors are stripped as unknown keys, by design. In production
 * they come from the `teams` table. `notificationTitle`/`notificationBody` read the nickname ("Colts
 * have the ball"), so it is worth getting right: the notification copy on the phone is part of what
 * the test is judging.
 *
 * Keys use OUR abbreviations, not ESPN's — `mapEspnPlay` already normalizes `WSH` to `WAS` before any
 * of this is looked up.
 */

export interface NflTeamInfo {
  nickname: string;
  primaryColor: string;
  secondaryColor: string;
}

export const NFL_TEAMS: Readonly<Record<string, NflTeamInfo>> = {
  ARI: { nickname: 'Cardinals', primaryColor: '#97233F', secondaryColor: '#FFB612' },
  ATL: { nickname: 'Falcons', primaryColor: '#A71930', secondaryColor: '#000000' },
  BAL: { nickname: 'Ravens', primaryColor: '#241773', secondaryColor: '#9E7C0C' },
  BUF: { nickname: 'Bills', primaryColor: '#00338D', secondaryColor: '#C60C30' },
  CAR: { nickname: 'Panthers', primaryColor: '#0085CA', secondaryColor: '#101820' },
  CHI: { nickname: 'Bears', primaryColor: '#0B162A', secondaryColor: '#C83803' },
  CIN: { nickname: 'Bengals', primaryColor: '#FB4F14', secondaryColor: '#000000' },
  CLE: { nickname: 'Browns', primaryColor: '#311D00', secondaryColor: '#FF3C00' },
  DAL: { nickname: 'Cowboys', primaryColor: '#003594', secondaryColor: '#869397' },
  DEN: { nickname: 'Broncos', primaryColor: '#FB4F14', secondaryColor: '#002244' },
  DET: { nickname: 'Lions', primaryColor: '#0076B6', secondaryColor: '#B0B7BC' },
  GB: { nickname: 'Packers', primaryColor: '#203731', secondaryColor: '#FFB612' },
  HOU: { nickname: 'Texans', primaryColor: '#03202F', secondaryColor: '#A71930' },
  IND: { nickname: 'Colts', primaryColor: '#002C5F', secondaryColor: '#A2AAAD' },
  JAX: { nickname: 'Jaguars', primaryColor: '#101820', secondaryColor: '#D7A22A' },
  KC: { nickname: 'Chiefs', primaryColor: '#E31837', secondaryColor: '#FFB81C' },
  LAC: { nickname: 'Chargers', primaryColor: '#0080C6', secondaryColor: '#FFC20E' },
  LAR: { nickname: 'Rams', primaryColor: '#003594', secondaryColor: '#FFA300' },
  LV: { nickname: 'Raiders', primaryColor: '#000000', secondaryColor: '#A5ACAF' },
  MIA: { nickname: 'Dolphins', primaryColor: '#008E97', secondaryColor: '#FC4C02' },
  MIN: { nickname: 'Vikings', primaryColor: '#4F2683', secondaryColor: '#FFC62F' },
  NE: { nickname: 'Patriots', primaryColor: '#002244', secondaryColor: '#C60C30' },
  NO: { nickname: 'Saints', primaryColor: '#D3BC8D', secondaryColor: '#101820' },
  NYG: { nickname: 'Giants', primaryColor: '#0B2265', secondaryColor: '#A71930' },
  NYJ: { nickname: 'Jets', primaryColor: '#125740', secondaryColor: '#000000' },
  PHI: { nickname: 'Eagles', primaryColor: '#004C54', secondaryColor: '#A5ACAF' },
  PIT: { nickname: 'Steelers', primaryColor: '#FFB612', secondaryColor: '#101820' },
  SEA: { nickname: 'Seahawks', primaryColor: '#002244', secondaryColor: '#69BE28' },
  SF: { nickname: '49ers', primaryColor: '#AA0000', secondaryColor: '#B3995D' },
  TB: { nickname: 'Buccaneers', primaryColor: '#D50A0A', secondaryColor: '#34302B' },
  TEN: { nickname: 'Titans', primaryColor: '#0C2340', secondaryColor: '#4B92DB' },
  WAS: { nickname: 'Commanders', primaryColor: '#5A1414', secondaryColor: '#FFB612' },
};

/** Falls back to the abbreviation itself so an unexpected/relocated abbreviation can't crash a run. */
export function teamInfo(abbreviation: string): NflTeamInfo {
  return (
    NFL_TEAMS[abbreviation] ?? {
      nickname: abbreviation,
      primaryColor: '#666666',
      secondaryColor: '#333333',
    }
  );
}
