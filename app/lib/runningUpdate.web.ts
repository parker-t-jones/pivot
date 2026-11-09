import type { RunningUpdate } from './updateLabel';

/** The web app is deployed by Cloudflare Pages, not EAS Update. */
export function runningUpdate(): RunningUpdate | null {
  return null;
}
