/** Missing `bet_game_ids` is today's Home: no bet watch list. */
export function readBetGameIds(response: { bet_game_ids?: string[] }): string[] {
  return response.bet_game_ids ?? [];
}

/** One chip. Further true bets collapse to "+n". Empty input is no chip. */
export function betChipLabel(labels: readonly string[]): string | null {
  const first = labels[0];
  if (!first) return null;
  if (labels.length === 1) return `BET · ${first}`;
  return `BET · ${first} +${labels.length - 1}`;
}

/** `bet_in_play` refetches `/flags/current` instead of editing the cards in place. */
export function betEventRequestsRefetch(eventType: string): boolean {
  return eventType === 'bet_in_play';
}
