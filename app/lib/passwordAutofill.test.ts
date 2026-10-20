import { describe, expect, it } from 'vitest';

import { PASSWORD_FIELD_AUTOFILL } from './passwordAutofill';
import { PASSWORD_RULES } from './passwordPolicy';

describe('password field autofill props', () => {
  it('marks sign-in as the current username and password', () => {
    expect(PASSWORD_FIELD_AUTOFILL.signIn.email).toMatchObject({
      name: 'username',
      textContentType: 'username',
      autoComplete: 'email',
      keyboardType: 'email-address',
    });
    expect(PASSWORD_FIELD_AUTOFILL.signIn.password).toMatchObject({
      name: 'current-password',
      textContentType: 'password',
      autoComplete: 'current-password',
    });
  });

  it('marks sign-up, reset, and change-password new fields as new passwords', () => {
    for (const field of [
      PASSWORD_FIELD_AUTOFILL.signUp.password,
      PASSWORD_FIELD_AUTOFILL.signUp.confirm,
      PASSWORD_FIELD_AUTOFILL.reset.password,
      PASSWORD_FIELD_AUTOFILL.reset.confirm,
      PASSWORD_FIELD_AUTOFILL.change.password,
      PASSWORD_FIELD_AUTOFILL.change.confirm,
    ]) {
      expect(field).toMatchObject({
        name: 'new-password',
        textContentType: 'newPassword',
        autoComplete: 'new-password',
        passwordRules: PASSWORD_RULES,
      });
    }
    expect(PASSWORD_FIELD_AUTOFILL.change.current.autoComplete).toBe('current-password');
    expect(PASSWORD_FIELD_AUTOFILL.forgot.email.textContentType).toBe('username');
  });
});
