import { expect, it, vi } from 'vitest';
import {
  APP_PROFILES,
  DEFAULT_EVAL_OUTPUT,
  loadAppEncoder,
  parseEvalOptions,
} from './evalOptions.js';

it('keeps defaults and selects app profiles without loading an encoder', () => {
  expect(parseEvalOptions([])).toMatchObject({ runs: 1, asApp: undefined, out: undefined });
  expect(parseEvalOptions(['--as-app']).asApp).toBe('ios');
  expect(parseEvalOptions(['--as-app=web']).asApp).toBe('web');
  expect(APP_PROFILES).toEqual({ ios: { quality: 70 }, web: { quality: 85, maxEdge: 2000 } });
});
it('parses flags and explicit prices', () => {
  expect(
    parseEvalOptions([
      '/private/slips',
      '--models',
      'a,b',
      '--price',
      'a=1:2',
      '--price=b=3:4',
      '--runs=3',
      '--out',
      '--draft-expected',
      '--production-path',
    ]),
  ).toMatchObject({
    dir: '/private/slips',
    models: [{ model: 'a' }, { model: 'b' }],
    runs: 3,
    out: DEFAULT_EVAL_OUTPUT,
    prices: {
      a: { inputPerMillion: 1, outputPerMillion: 2 },
      b: { inputPerMillion: 3, outputPerMillion: 4 },
    },
    draftExpected: true,
    productionPath: true,
  });
});
it('rejects invalid flags before reads', () => {
  for (const args of [
    ['--runs=0'],
    ['--runs=1.5'],
    ['--models', 'a,,b'],
    ['--price', 'a=-1:2'],
    ['--price', 'a=.:2'],
    ['--as-app=android'],
    ['--oops'],
    ['--models'],
  ])
    expect(() => parseEvalOptions(args)).toThrow();
});
it('reports lazy loader failures with an actionable message using a stub', async () => {
  const stub = vi.fn().mockRejectedValue(new Error('native module missing'));
  await expect(loadAppEncoder(stub)).rejects.toThrow('--as-app requires sharp');
  expect(stub).toHaveBeenCalledOnce();
  const encoder = {};
  expect(await loadAppEncoder(async () => encoder)).toBe(encoder);
});
