/**
 * Injectable clock. Section 8's `computeFlagState` / `makeEvent` call `Date.now()` directly; the
 * engine threads a `Clock` instead so pure functions stay deterministic under test (production
 * passes `defaultClock`). This is a testability affordance, NOT a Section 8 spec change — the
 * priority formula and rule order are untouched.
 */
export type Clock = () => number;

export const defaultClock: Clock = () => Date.now();
