/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * Millisecond wall clock, to be recorded in the same screen region as the broadcast. It is the
 * reference that turns "the play looked like it appeared around then" into a number: scrub the
 * recording to the frame where a play becomes visible, read this clock, and subtract it from the
 * harness's `deliveredAt`.
 *
 * It reads the same `Date.now()` source the harness does, on the same machine, which is the whole
 * reason the measured run avoids AirPlay — one clock, no drift term. (Measured at setup: this machine
 * was +104ms against time.apple.com, three orders of magnitude below the quantity being measured.)
 *
 * Both fields come from a SINGLE timestamp. Deriving `HH:MM:SS` and the milliseconds from two separate
 * reads lets them straddle a second boundary and print a millisecond value belonging to the wrong
 * second — a rare but full 1-second error, in the one artifact the entire measurement is calibrated
 * against.
 *
 * Usage:
 *   npx tsx experiments/reference-clock.ts
 *
 *   Turn the terminal font size up before recording; legibility in the recording is the only
 *   requirement. Ctrl-C to stop.
 */

/** 20ms is below a 60fps frame interval, so no recorded frame catches a stale value. */
const TICK_MS = 20;

function render(now: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}`
  );
}

console.log(`Reference clock — record this in frame with the broadcast.\n`);

setInterval(() => {
  process.stdout.write(`\r  ${render(new Date())}   `);
}, TICK_MS);
