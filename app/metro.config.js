// Monorepo watchFolders / nodeModulesPaths come from expo/metro-config automatically (SDK 52+);
// don't set them here.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `shared/` is NodeNext ESM, so its relative imports name the emitted `.js` file
// (`./types.js`) while only `types.ts` exists in `shared/src`. Metro has no `.js` -> `.ts`
// fallback, so drop the extension and let `sourceExts` find the `.ts`.
const sharedSrc = path.resolve(__dirname, '../shared/src') + path.sep;
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (
    context.originModulePath.startsWith(sharedSrc) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    return resolve(context, moduleName.slice(0, -'.js'.length), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
