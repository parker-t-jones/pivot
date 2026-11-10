/**
 * Expo config plugin: adds the `NotificationService` Notification Service Extension target to the
 * generated iOS project at prebuild, so EAS Build produces an app that draws the team badge on
 * rich pushes (issue #49). Uses only `expo/config-plugins`; no new packages.
 *
 * NOT RUN ANYWHERE YET. It was written without the ability to install dependencies or run
 * `expo prebuild`. Run `npx expo prebuild --platform ios --no-install --clean` in a scratch copy
 * and open the result in Xcode before trusting it (see the PR for the exact steps).
 *
 * The extension's bundle id is `<app bundle id>.NotificationService`. The main bundle id is not
 * touched.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'NotificationService';
const SOURCE_FILES = ['NotificationService.swift', 'Info.plist'];
const DEPLOYMENT_TARGET = '15.1';

function extensionBundleId(config) {
  const appId = config.ios && config.ios.bundleIdentifier;
  if (!appId) {
    throw new Error(`${TARGET} plugin: expo.ios.bundleIdentifier must be set in app.json.`);
  }
  return `${appId}.${TARGET}`;
}

/** Copies the Swift source and Info.plist into the generated `ios/NotificationService/` folder. */
function withExtensionFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const destination = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(destination, { recursive: true });
      for (const file of SOURCE_FILES) {
        fs.copyFileSync(path.join(__dirname, file), path.join(destination, file));
      }
      return cfg;
    },
  ]);
}

/** Adds the app-extension target, its build phases, group and build settings. Safe to re-run. */
function withExtensionTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET)) return cfg;

    const bundleId = extensionBundleId(cfg);
    const target = project.addTarget(TARGET, 'app_extension', TARGET, bundleId);
    project.addBuildPhase(
      ['NotificationService.swift'],
      'PBXSourcesBuildPhase',
      'Sources',
      target.uuid,
    );
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    const group = project.addPbxGroup(SOURCE_FILES, TARGET, TARGET);
    const groups = project.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => {
      const entry = groups[key];
      if (typeof entry === 'object' && entry.name === undefined && entry.path === undefined) {
        project.addToPbxGroup(group.uuid, key);
      }
    });

    const marketingVersion = cfg.version || '1.0.0';
    const buildNumber = (cfg.ios && cfg.ios.buildNumber) || '1';
    const configurations = project.pbxXCBuildConfigurationSection();
    Object.keys(configurations).forEach((key) => {
      const settings = configurations[key].buildSettings;
      if (settings === undefined || settings.PRODUCT_NAME !== `"${TARGET}"`) return;
      settings.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleId}"`;
      settings.INFOPLIST_FILE = `${TARGET}/Info.plist`;
      settings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      settings.TARGETED_DEVICE_FAMILY = '"1"';
      settings.SWIFT_VERSION = '5.0';
      settings.CODE_SIGN_STYLE = 'Automatic';
      settings.CLANG_ENABLE_MODULES = 'YES';
      settings.MARKETING_VERSION = marketingVersion;
      settings.CURRENT_PROJECT_VERSION = buildNumber;
    });

    return cfg;
  });
}

/** Tells EAS Build about the extension so it can create and manage its signing credentials. */
function withEasAppExtension(config) {
  const eas = (config.extra && config.extra.eas) || {};
  const build = eas.build || {};
  const experimental = build.experimental || {};
  const ios = experimental.ios || {};
  const others = (ios.appExtensions || []).filter((ext) => ext.targetName !== TARGET);
  config.extra = {
    ...config.extra,
    eas: {
      ...eas,
      build: {
        ...build,
        experimental: {
          ...experimental,
          ios: {
            ...ios,
            appExtensions: [
              ...others,
              { targetName: TARGET, bundleIdentifier: extensionBundleId(config) },
            ],
          },
        },
      },
    },
  };
  return config;
}

module.exports = function withNotificationService(config) {
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  return withEasAppExtension(config);
};
