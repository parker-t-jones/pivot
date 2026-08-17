import { describe, expect, it } from 'vitest';
import {
  buildPlayerSearchText,
  playerSearchTextMatches,
} from './playerSearchText.js';

function text(parts: {
  first_name: string;
  last_name: string;
  position: string;
  city: string;
  name: string;
  abbreviation: string;
}): string {
  return buildPlayerSearchText(parts);
}

const montgomeryDet = text({
  first_name: 'David',
  last_name: 'Montgomery',
  position: 'RB',
  city: 'Detroit',
  name: 'Lions',
  abbreviation: 'DET',
});
const mooreCar = text({
  first_name: 'David',
  last_name: 'Moore',
  position: 'WR',
  city: 'Charlotte',
  name: 'Panthers',
  abbreviation: 'CAR',
});
const sillsTb = text({
  first_name: 'David',
  last_name: 'Sills',
  position: 'WR',
  city: 'Tampa',
  name: 'Buccaneers',
  abbreviation: 'TB',
});
const lionsDef = text({
  first_name: '',
  last_name: 'Defense',
  position: 'DEF',
  city: 'Detroit',
  name: 'Lions',
  abbreviation: 'DET',
});
const bucsDef = text({
  first_name: '',
  last_name: 'Defense',
  position: 'DEF',
  city: 'Tampa',
  name: 'Buccaneers',
  abbreviation: 'TB',
});
const goffDet = text({
  first_name: 'Jared',
  last_name: 'Goff',
  position: 'QB',
  city: 'Detroit',
  name: 'Lions',
  abbreviation: 'DET',
});

describe('buildPlayerSearchText', () => {
  it('includes team fields only for DEF; skill players are name-only', () => {
    expect(lionsDef).toBe('defense detroit lions det');
    expect(bucsDef).toBe('defense tampa buccaneers tb');
    expect(montgomeryDet).toBe('david montgomery');
    expect(goffDet).toBe('jared goff');
  });
});

describe('playerSearchTextMatches (search_players contract)', () => {
  it('matches a single first-name token', () => {
    expect(playerSearchTextMatches(montgomeryDet, 'David')).toBe(true);
    expect(playerSearchTextMatches(goffDet, 'David')).toBe(false);
  });

  it('AND across tokens: David M matches Montgomery/Moore, not Tampa-only Sills', () => {
    expect(playerSearchTextMatches(montgomeryDet, 'David M')).toBe(true);
    expect(playerSearchTextMatches(mooreCar, 'David M')).toBe(true);
    // Name-only text has no city — Sills still fails because last_name does not start with M.
    expect(playerSearchTextMatches(sillsTb, 'David M')).toBe(false);
  });

  it('team name/city/abbrev match DEF only, never skill players on that team', () => {
    expect(playerSearchTextMatches(lionsDef, 'Lions')).toBe(true);
    expect(playerSearchTextMatches(lionsDef, 'Detroit')).toBe(true);
    expect(playerSearchTextMatches(lionsDef, 'DET')).toBe(true);
    expect(playerSearchTextMatches(goffDet, 'Lions')).toBe(false);
    expect(playerSearchTextMatches(goffDet, 'Detroit')).toBe(false);
    expect(playerSearchTextMatches(goffDet, 'DET')).toBe(false);

    expect(playerSearchTextMatches(bucsDef, 'Buccaneers')).toBe(true);
    expect(playerSearchTextMatches(bucsDef, 'Tampa')).toBe(true);
    expect(playerSearchTextMatches(bucsDef, 'TB')).toBe(true);
    expect(playerSearchTextMatches(sillsTb, 'Buccaneers')).toBe(false);
    expect(playerSearchTextMatches(sillsTb, 'Tampa')).toBe(false);
    expect(playerSearchTextMatches(sillsTb, 'TB')).toBe(false);
  });

  it('matches the literal Defense last_name token', () => {
    expect(playerSearchTextMatches(lionsDef, 'Defense')).toBe(true);
    expect(playerSearchTextMatches(montgomeryDet, 'Defense')).toBe(false);
  });

  it('rejects empty / whitespace-only queries', () => {
    expect(playerSearchTextMatches(montgomeryDet, '   ')).toBe(false);
    expect(playerSearchTextMatches(montgomeryDet, '')).toBe(false);
  });
});
