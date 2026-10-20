import { createElement, type FormEvent, type ReactNode } from 'react';

/**
 * Real form so Chrome / Safari offer to save or update the password.
 * The hidden submit button lets Enter submit; the visible button uses `onPress`.
 */
export function AuthForm({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  return createElement(
    'form',
    {
      noValidate: true,
      style: { width: '100%' },
      onSubmit: (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      },
    },
    children,
    createElement('button', {
      type: 'submit',
      hidden: true,
      tabIndex: -1,
      'aria-hidden': true,
    }),
  );
}
