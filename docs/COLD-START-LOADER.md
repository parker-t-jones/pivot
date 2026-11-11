# Cold-start loader

The optional `step` / `steps` props on `YardLineLoader` and `LoadingState` describe
one-based, real stages. They are stage positions, not a percentage of requests
completed. Both must be valid integers and `steps` must be positive; otherwise
the existing indeterminate loader is used. Out-of-range steps are clamped.

The startup path uses six positions:

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
6. **Finding your games…** — Home's existing loading surface stays mounted until
   its data load settles. With leagues, Home reads `/me`, then NFL state, then
   lineups/current flags/live games/week games concurrently. A top flag may also
   require broadcast lookup. No leagues and season-idle take their existing early
   returns; manual picks continue loading separately as before.

Conditional redirects and requests can be skipped. No stage is artificially held
on screen, and no timer advances the stage. The ball animates only toward a
changed prop position; reduced motion sets that position immediately without a
pulse. Its accessible name remains “Loading”. Callers without both props retain
the original sweep/static-markers-and-pulse behavior.

Home's and Watchlist's content placeholders and slow-load treatment belong to
#93. This change only adds props/copy to Home's existing loader.

Manual check: cold-open the app signed in, with leagues and granted/denied alert
permission. Expect session, leagues/alerts, and games stages as their actual work
runs; fast stages may not be visible. Cold-open signed out and expect welcome
after the session check. With no leagues, expect the connect screen after the app
gate. Enable Reduce Motion and repeat: the ball should hold each stage position
without a jump animation. Check iOS on a device for native spacing and feel;
rendered web tests do not establish native layout or real-device timing.
