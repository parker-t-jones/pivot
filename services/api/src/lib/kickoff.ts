/**
 * A game has kicked off once the runner marks it live or final, or once its scheduled
 * start has passed. The clock check covers a runner that has not flipped the status yet.
 */
export function gameHasKickedOff(
  game: { status: string; scheduled_start: string },
  now: Date,
): boolean {
  if (game.status === 'in_progress' || game.status === 'final') return true;
  const start = Date.parse(game.scheduled_start);
  return Number.isFinite(start) && start <= now.getTime();
}
