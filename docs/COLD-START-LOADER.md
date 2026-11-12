# Cold-start loader

The optional `step` / `steps` props on `YardLineLoader` and `LoadingState` describe
one-based, real stages. They are stage positions, not a percentage of requests
completed. Both must be valid integers and `steps` must be positive; otherwise
the existing indeterminate loader is used. Out-of-range steps are clamped.

The startup path uses five positions:

1. **Loading fonts…** — root `useFonts` has not resolved. SessionProvider is not
   mounted yet.
2. **Checking your session…** — SessionProvider is restoring auth; both root and
   index use this position.
3. **Opening your screen…** — the root auth gate has decided to replace the route.
   Index otherwise returns its Redirect directly.
4. **Checking your leagues and alerts…** — the app group waits on the concurrent
   leagues request and push-permission read. There is no separate profile gate.
5. **Opening your screen…** — the app gate is redirecting to connect/notifications
   or leaving notifications. An error keeps the existing error/retry surface.

After stage 5, Home hands off to its shaped content placeholders rather than a
sixth yard-line stage. Home delays placeholders by 150ms and keeps them visible
for at least 300ms once shown. A load lasting eight seconds offers the neutral
slow-load message and Retry. Remembered Watchlist data stays visible during a
refetch instead of being replaced by placeholders.

Conditional redirects and requests can be skipped. No stage is artificially held
on screen, and no timer advances the stage. The ball animates only toward a
changed prop position; reduced motion sets that position immediately without a
pulse. Its accessible name remains “Loading”. Callers without both props retain
the original sweep/static-markers-and-pulse behavior.

Manual check: cold-open the app signed in, with leagues and granted/denied alert
permission. Expect session and leagues/alerts stages as their actual work runs; fast stages
may not be visible. If Home data is still pending, expect its shaped placeholders
after the handoff, with no sixth yard-line stage. Cold-open signed out and expect welcome
after the session check. With no leagues, expect the connect screen after the app
gate. Enable Reduce Motion and repeat: the ball should hold each stage position
without a jump animation. Check iOS on a device for native spacing and feel;
rendered web tests do not establish native layout or real-device timing.
