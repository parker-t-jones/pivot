import { pickSlipImage } from '../lib/slipImage';
import { SecondaryButton } from './SecondaryButton';

export interface SlipImportButtonProps {
  /** Base64 image or data URL, after the user chose a screenshot. */
  onImage: (image: string) => void;
  /** No free bets left: the button opens the upgrade sheet instead of the picker. */
  onLocked?: (() => void) | null;
  loading: boolean;
  disabled?: boolean;
  onError: (message: string) => void;
}

export const SLIP_IMPORT_LABEL = 'Import from screenshot';

/** "Import from screenshot" on iOS: the system photo picker. */
export function SlipImportButton({
  onImage,
  onLocked = null,
  loading,
  disabled = false,
  onError,
}: SlipImportButtonProps) {
  const press = () => {
    if (onLocked) {
      onLocked();
      return;
    }
    void pickSlipImage().then(
      (image) => {
        if (image) onImage(image);
      },
      () => onError('We couldn’t open your photos. Try again.'),
    );
  };
  return (
    <SecondaryButton
      caption={onLocked ? 'No free bets left · Upgrade' : 'Choose a bet slip from your photos'}
      disabled={disabled}
      label={SLIP_IMPORT_LABEL}
      loading={loading}
      onPress={press}
    />
  );
}
