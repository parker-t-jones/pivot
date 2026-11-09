/**
 * Bet slip screenshot import (#12) is on when the server has a Claude API key. The key is read
 * from `ANTHROPIC_API_KEY` (a Fly secret) and never leaves this process.
 */
export interface SlipImportEnv {
  ANTHROPIC_API_KEY?: string | undefined;
}

export function slipImportStatus(source: SlipImportEnv): 'enabled' | 'disabled' {
  const key = source.ANTHROPIC_API_KEY;
  return key !== undefined && key.trim() !== '' ? 'enabled' : 'disabled';
}

/** Largest decoded image the API accepts. The Claude API's own per-image limit is 5 MB. */
export const SLIP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Request body ceiling for `POST /picks/import`: the base64 image plus a little JSON. */
export const SLIP_IMPORT_BODY_LIMIT = Math.ceil((SLIP_IMAGE_MAX_BYTES * 4) / 3) + 4096;

export interface SlipImportLimits {
  free: number;
  pro: number;
}
