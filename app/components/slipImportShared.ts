export interface SlipImportButtonProps {
  /** Base64 image or data URL, after the user chose a screenshot. */
  onImage: (image: string) => void;
  /** No free bets left: the button opens the upgrade sheet instead of the picker. */
  onLocked?: (() => void) | null;
  loading: boolean;
  disabled?: boolean;
  onError: (message: string) => void;
}

/**
 * Lives here, not in `SlipImportButton.tsx`: on web, `./SlipImportButton` resolves to
 * `SlipImportButton.web.tsx`, so importing the label from there made the web file import itself.
 */
export const SLIP_IMPORT_LABEL = 'Import from screenshot';
