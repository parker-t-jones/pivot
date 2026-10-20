// Monorepo watchFolders / nodeModulesPaths come from expo/metro-config automatically (SDK 52+);
// don't set them here.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `shared/` is NodeNext ESM, so its relative imports name the emitted `.js` file
// (`./types.js`) while only `types.ts` exists in `shared/src`. Metro has no `.js` -> `.ts`
// fallback, so drop the extension and let `sourceExts` find the `.ts`.
// Web export resolves `@pivot/shared/*` through the `browser` condition (not
// `react-native`). That condition points at this source tree; `dist/` is not
// built by the Pages command.
const sharedSrc = path.resolve(__dirname, '../shared/src') + path.sep;
const upstreamResolveRequest = config.resolver.resolveRequest;

// The live-card preview and its captured payloads stay out of the production graph.
// `expo export` sets NODE_ENV=production. `expo start` does not, so the dev server still loads them.
const previewSource = path.resolve(__dirname, 'components/LiveCardPreview.tsx');
const previewStub = path.resolve(__dirname, 'dev/previewInert.tsx');
const fixtureSource = path.resolve(__dirname, 'fixtures/mnfHalftime.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (
    context.originModulePath.startsWith(sharedSrc) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    return resolve(context, moduleName.slice(0, -'.js'.length), platform);
  }
  const resolved = resolve(context, moduleName, platform);
  if (process.env.NODE_ENV === 'production' && resolved?.type === 'sourceFile') {
    if (resolved.filePath === previewSource) {
      return { type: 'sourceFile', filePath: previewStub };
    }
    if (resolved.filePath === fixtureSource) {
      return { type: 'empty' };
    }
  }
  return resolved;
};

module.exports = config;
