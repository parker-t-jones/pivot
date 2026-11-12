import { MODEL_CANDIDATES } from './modelEval.js';
import { MODEL_PRICING, type ModelPricing } from './modelCost.js';

export const DEFAULT_EVAL_OUTPUT = '../../experiments/slip-eval/results.json';
export type AppProfile = 'ios' | 'web';
export const APP_PROFILES = {
  ios: { quality: 70 },
  web: { quality: 85, maxEdge: 2000 },
} as const;

export function parseEvalOptions(args: string[]) {
  let dir = '../../experiments/slip-eval',
    runs = 1;
  let models = MODEL_CANDIDATES,
    asApp: AppProfile | undefined,
    out: string | undefined;
  let productionPath = false,
    draftExpected = false;
  const prices: Record<string, ModelPricing> = { ...MODEL_PRICING };
  if (args[0] && !args[0].startsWith('--')) dir = args.shift() ?? dir;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const equal = arg.indexOf('=');
    const flag = equal === -1 ? arg : arg.slice(0, equal);
    const inline = equal === -1 ? undefined : arg.slice(equal + 1);
    const value = () => {
      const result = inline ?? args[++i];
      if (!result || result.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      return result;
    };
    switch (flag) {
      case '--models': {
        const ids = value().split(',');
        if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
          throw new Error('Invalid --models');
        models = ids.map((model) => ({ model, label: model }));
        break;
      }
      case '--price': {
        // Keep '=' within the price value when --price=id=in:out is used.
        const text = arg.startsWith('--price=') ? arg.slice(8) : value();
        const match = /^([^=]+)=([\d.]+):([\d.]+)$/.exec(text);
        if (!match) throw new Error('Expected --price id=in:out');
        const inputPerMillion = Number(match[2]),
          outputPerMillion = Number(match[3]);
        if (![inputPerMillion, outputPerMillion].every((n) => Number.isFinite(n) && n >= 0))
          throw new Error('Invalid price');
        const model = match[1];
        if (!model) throw new Error('Missing price model');
        prices[model] = { inputPerMillion, outputPerMillion };
        break;
      }
      case '--runs':
        runs = Number(value());
        if (!Number.isSafeInteger(runs) || runs < 1)
          throw new Error('--runs must be a positive integer');
        break;
      case '--as-app': {
        const profile = inline ?? 'ios';
        if (profile !== 'ios' && profile !== 'web') throw new Error('--as-app must be ios or web');
        asApp = profile;
        break;
      }
      case '--out':
        out =
          inline ??
          (args[i + 1] && !args[i + 1]?.startsWith('--') ? args[++i] : DEFAULT_EVAL_OUTPUT);
        break;
      case '--production-path':
        if (inline !== undefined) throw new Error('--production-path takes no value');
        productionPath = true;
        break;
      case '--draft-expected':
        if (inline !== undefined) throw new Error('--draft-expected takes no value');
        draftExpected = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dir, runs, models, prices, asApp, out, productionPath, draftExpected };
}

/** Loader is injected: unit tests never need an encoder or native binary. */
export async function loadAppEncoder<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new Error(
      '--as-app requires sharp. Install API devDependencies with pnpm install --frozen-lockfile.',
    );
  }
}
