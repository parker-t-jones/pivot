import type { PressableStateCallbackType } from 'react-native';

/**
 * React Native's press state type has `pressed` only. On web the same callback also
 * receives `hovered` and `focused`. iOS never reads this.
 */
export function webPressState(state: PressableStateCallbackType): {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
} {
  const web = state as PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
  return {
    pressed: state.pressed,
    hovered: web.hovered === true,
    focused: web.focused === true,
  };
}
