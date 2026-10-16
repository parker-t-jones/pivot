import { Alert, type AlertButton } from 'react-native';

/**
 * Native dialogs. Metro loads `confirm.web.ts` instead of this file on web, where `Alert.alert`
 * returns without showing anything.
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}

/** A single-button alert. Omitted buttons become the default OK. */
export interface AlertAction {
  text: string;
  style?: NonNullable<AlertButton['style']>;
  onPress?: () => void;
}

export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmLabel, cancelLabel, destructive = false } = options;
  return new Promise((resolve) => {
    const confirmButton: AlertButton = destructive
      ? { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }
      : { text: confirmLabel, onPress: () => resolve(true) };
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      confirmButton,
    ]);
  });
}

export function alertAsync(
  title: string,
  message: string,
  buttons?: readonly AlertAction[],
): Promise<void> {
  return new Promise((resolve) => {
    const actions = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
    Alert.alert(
      title,
      message,
      actions.map((button) => ({
        text: button.text,
        ...(button.style !== undefined ? { style: button.style } : {}),
        onPress: () => {
          button.onPress?.();
          resolve();
        },
      })),
    );
  });
}
