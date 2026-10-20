import type { ReactNode } from 'react';

/**
 * Native is not a document form. Web (`AuthForm.web.tsx`) renders a real `<form>`
 * so browsers can offer to save the password.
 */
export function AuthForm({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  void onSubmit;
  return <>{children}</>;
}
