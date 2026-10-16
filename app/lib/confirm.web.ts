/**
 * Web dialogs. `Alert.alert` is a no-op in react-native-web, so confirms and alerts go through
 * the browser. iOS keeps `confirm.ts`.
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}

export interface AlertAction {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  return Promise.resolve(window.confirm(`${options.title}\n\n${options.message}`));
}

export function alertAsync(
  title: string,
  message: string,
  buttons?: readonly AlertAction[],
): Promise<void> {
  window.alert(`${title}\n\n${message}`);
  if (buttons) {
    for (const button of buttons) button.onPress?.();
  }
  return Promise.resolve();
}
