/**
 * Content for the replayable quick tour (issue #32 / PIVOT-STAKES-PLAN.md §12.2). Pure data so
 * the card order and copy are unit-testable without mounting the screen.
 */
export interface TourCard {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
}

export const TOUR_CARDS: readonly TourCard[] = [
  {
    id: 'board',
    eyebrow: 'Card 1 of 4',
    title: 'This is the Board.',
    body:
      "The whole week's slate, with YOUR PICKS marked on the games you've got something riding on. " +
      'The top card is your biggest one. Flip to MY CARD to see just yours.',
  },
  {
    id: 'live',
    eyebrow: 'Card 2 of 4',
    title: "When it's live, Home lights up.",
    body: "When something's worth switching for, the top card goes LIVE and tells you exactly where to go.",
  },
  {
    id: 'alerts',
    eyebrow: 'Card 3 of 4',
    title: 'Alerts land at the right moment.',
    body:
      'Pivot sends you to the game before the drive starts. Tap an alert to jump straight to the ' +
      'right channel. If alerts land too early or too late, change Alert timing in Settings.',
  },
  {
    id: 'watchlist',
    eyebrow: 'Card 4 of 4',
    title: 'Your Watchlist.',
    body:
      "Everything you've got riding, in one place — a card per pick, with your fantasy leagues " +
      'collapsed together. Free covers 3 picks a week; a parlay counts as one.',
  },
] as const;

export type TourEndAction = 'demo' | 'home';

/** `true` while there is a next card; the last card instead offers the two end actions. */
export function tourHasNextCard(index: number): boolean {
  return index < TOUR_CARDS.length - 1;
}
