import { pickSlipImage } from '../lib/slipImage';
import { SecondaryButton } from './SecondaryButton';
import { SLIP_IMPORT_LABEL, type SlipImportButtonProps } from './slipImportShared';

export { SLIP_IMPORT_LABEL, type SlipImportButtonProps };

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
