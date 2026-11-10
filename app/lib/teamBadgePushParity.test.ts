import { describe, expect, it } from 'vitest';

// Relative path on purpose: the app may not import the `@pivot/shared` root (server-only exports),
// and this module is self-contained.
import { buildPushTeamBadge } from '../../shared/src/push/teamBadge';
import { NFL_TEAM_ABBREVIATIONS, badgeColors } from './teamColors';

/**
 * The push badge (drawn by the iOS Notification Service Extension) mirrors the in-app `TeamBadge`
 * colors. If a team color or the ink rule changes in `teamColors.ts`, this fails until
 * `shared/src/push/teamBadge.ts` is updated to match.
 */
describe('push team badge matches the app TeamBadge', () => {
  it.each(NFL_TEAM_ABBREVIATIONS)('%s', (abbr) => {
    const app = badgeColors(abbr);
    const push = buildPushTeamBadge(abbr);
    expect(push).not.toBeNull();
    expect(push?.fill.toUpperCase()).toBe(app.fill.toUpperCase());
    expect(push?.border.toUpperCase()).toBe(app.border.toUpperCase());
    expect(push?.ink.toUpperCase()).toBe(app.textColor.toUpperCase());
    expect(push?.initials).toBe(abbr);
  });
});
