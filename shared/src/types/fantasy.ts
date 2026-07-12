/** `players.position` (Section 7). IDP positions are explicitly out of scope for v1 (Section 4). */
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

/** `lineup_slots.slot_type` (Section 7). */
export type SlotType = 'starter' | 'bench' | 'flex' | 'idp';

/** `leagues.platform` (Section 7). */
export type LeaguePlatform = 'sleeper' | 'manual' | 'espn' | 'yahoo' | 'nfl_fantasy' | 'cbs';
