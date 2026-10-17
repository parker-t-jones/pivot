/** Home stake-line eyebrow. Survivor pools are not bets. */
export function stakeLineEyebrow(type: string): 'BET' | 'POOL' {
  return type === 'SURVIVOR' ? 'POOL' : 'BET';
}
