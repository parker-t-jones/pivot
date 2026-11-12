/** Eval CLI only. Never imported by the API or tests. Real reads cost money. */
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { loadEvalImages } from './lib/slipImport/evalImages.js';
import {
  evalModels,
  formatComparisonTable,
  formatModelEvalResult,
  type ModelReader,
} from './lib/slipImport/modelEval.js';
import { readSlipWithModel, productionModelReader } from './lib/slipImport/multiModelReader.js';
import { AnthropicSlipReader, SLIP_READ_MODEL } from './lib/slipImport/reader.js';
import { APP_PROFILES, loadAppEncoder, parseEvalOptions } from './lib/slipImport/evalOptions.js';
import { rescoreResults } from './lib/slipImport/rescore.js';
import { costForUsage, type TokenUsage } from './lib/slipImport/modelCost.js';

async function main(): Promise<void> {
  const options = parseEvalOptions(process.argv.slice(2));
  if (options.rescore) {
    const explicitDir =
      process.argv[2] && !process.argv[2].startsWith('--') ? options.dir : undefined;
    const rescored = await rescoreResults(options.rescore, explicitDir);
    if (options.out) {
      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, JSON.stringify(rescored, null, 2), { mode: 0o600 });
      console.log(`JSON written to ${options.out}`);
    }
    for (const result of rescored.results) console.log(`${formatModelEvalResult(result)}\n`);
    console.log(formatComparisonTable(rescored.results));
    return;
  }
  if (options.productionPath) {
    if (
      options.models.some((m) => m.model !== SLIP_READ_MODEL) &&
      process.argv.some((a) => a.startsWith('--models'))
    )
      throw new Error('--production-path uses only the pinned production model; omit --models.');
    options.models = [{ model: SLIP_READ_MODEL, label: 'Production path' }];
  }
  for (const candidate of options.models)
    costForUsage(candidate.model, { input_tokens: 0, output_tokens: 0 }, options.prices);
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the slip model eval.');
  const { cases, skipped } = await loadEvalImages(options.dir, {
    allowMissingExpected: options.draftExpected,
  });
  for (const name of skipped) console.log(`${name}: not an image the reader takes, skipped`);
  if (!cases.length) {
    console.log(`No screenshots in ${options.dir}. See experiments/slip-eval/README.md.`);
    return;
  }
  if (options.asApp) {
    // Only this optional eval path loads the native encoder.
    const { default: sharp } = await loadAppEncoder(() => import('sharp'));
    const profile = APP_PROFILES[options.asApp];
    for (const item of cases) {
      let encoder = sharp(Buffer.from(item.image.data, 'base64')).rotate();
      if ('maxEdge' in profile)
        encoder = encoder.resize({
          width: profile.maxEdge,
          height: profile.maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        });
      item.image = {
        mediaType: 'image/jpeg',
        data: (await encoder.jpeg({ quality: profile.quality }).toBuffer()).toString('base64'),
      };
    }
    console.log(
      `App profile: ${options.asApp}, JPEG quality ${profile.quality}${'maxEdge' in profile ? ', long edge <= 2000px' : ', no resize'}`,
    );
  }
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });
  let usage: TokenUsage | null = null;
  // Observe the SDK response without modifying the production reader or request shape.
  if (options.productionPath) {
    client.beta.messages.create = new Proxy(client.beta.messages.create, {
      async apply(target, thisArg, args) {
        const response = (await Reflect.apply(target, thisArg, args)) as Anthropic.Beta.BetaMessage;
        usage = response.usage;
        return response;
      },
    });
  }
  const productionReader = options.productionPath ? new AnthropicSlipReader(key, client) : null;
  const read: ModelReader = productionReader
    ? productionModelReader(
        {
          read: (image) => {
            usage = null;
            return productionReader.read(image);
          },
        },
        () => usage,
      )
    : (model, image) => readSlipWithModel(client, model, image);
  console.log(
    `Running ${cases.length} image(s) through ${options.models.length} models, ${options.runs} run(s)...`,
  );
  const results = await evalModels(options.models, cases, read, options);
  if (options.draftExpected) {
    for (const record of results[0]?.records.filter((r) => r.run === 1 && !r.failure) ?? []) {
      const base = record.name.slice(0, -extname(record.name).length);
      await writeFile(
        join(options.dir, `${base}.expected.draft.json`),
        JSON.stringify(
          {
            verification:
              'UNVERIFIED MODEL DRAFT — review every field before creating ground truth',
            sourceModel: record.model,
            ...record.read,
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
    }
    console.log('UNVERIFIED drafts written; draft-only cases are not scored.');
  }
  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, JSON.stringify({ version: 1, options, results }, null, 2), {
      mode: 0o600,
    });
    console.log(`JSON written to ${options.out}`);
  }
  for (const result of results) console.log(`${formatModelEvalResult(result)}\n`);
  console.log(formatComparisonTable(results));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
