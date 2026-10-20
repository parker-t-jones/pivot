/**
 * Hosted auth config (project taucqrptzfyzhfzpinzo, read via the management API)
 * and local `supabase/config.toml` agree: minimum length 6, no character-class
 * requirements, HaveIBeenPwned off. Secure password change is off, so
 * `updateUser({ password })` does not need a reauthentication nonce.
 */
export const PASSWORD_MIN_LENGTH = 6;

/** Shown under new-password fields. */
export const PASSWORD_POLICY_HINT = 'At least 6 characters.';

/** iOS Password AutoFill rule. Matches the length-only policy. */
export const PASSWORD_RULES = 'minlength: 6;';

export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export type NewPasswordIssue = 'weak' | 'mismatch';

export function newPasswordIssue(password: string, confirmation: string): NewPasswordIssue | null {
  if (passwordPolicyError(password)) return 'weak';
  if (password !== confirmation) return 'mismatch';
  return null;
}

export function newPasswordIssueMessage(issue: NewPasswordIssue): string {
  if (issue === 'weak') return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  return 'Passwords do not match.';
}
