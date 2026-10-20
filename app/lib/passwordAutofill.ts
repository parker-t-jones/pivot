import { PASSWORD_RULES } from './passwordPolicy';

/**
 * AutoFill / password-manager hints. Screens spread these onto `TextField`.
 * `name` is written onto the DOM input on web (react-native-web does not
 * forward a `name` prop). iOS uses `textContentType`; both platforms use
 * `autoComplete`.
 */
export const signInEmailAutofill = {
  name: 'username',
  textContentType: 'username',
  autoComplete: 'email',
  keyboardType: 'email-address',
  autoCapitalize: 'none',
} as const;

export const signInPasswordAutofill = {
  name: 'current-password',
  textContentType: 'password',
  autoComplete: 'current-password',
  autoCapitalize: 'none',
  secureTextEntry: true,
} as const;

export const newPasswordAutofill = {
  name: 'new-password',
  textContentType: 'newPassword',
  autoComplete: 'new-password',
  autoCapitalize: 'none',
  secureTextEntry: true,
  passwordRules: PASSWORD_RULES,
} as const;

export const PASSWORD_FIELD_AUTOFILL = {
  signIn: { email: signInEmailAutofill, password: signInPasswordAutofill },
  signUp: {
    email: signInEmailAutofill,
    password: newPasswordAutofill,
    confirm: newPasswordAutofill,
  },
  reset: { password: newPasswordAutofill, confirm: newPasswordAutofill },
  change: {
    current: signInPasswordAutofill,
    password: newPasswordAutofill,
    confirm: newPasswordAutofill,
  },
  forgot: { email: signInEmailAutofill },
} as const;
