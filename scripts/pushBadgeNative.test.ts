import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PUSH_TEAM_BADGE_KEY, buildPushTeamBadge } from '../shared/src/push/teamBadge.js';

/**
 * The Notification Service Extension is Swift and the config plugin is JS, so nothing compiles them
 * here. These checks pin the contract between them and the server payload so a rename on one side
 * fails CI instead of silently producing plain notifications.
 */
const read = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8');

const swift = read('plugins/notification-service/NotificationService.swift');
const plist = read('plugins/notification-service/Info.plist');
const plugin = read('plugins/notification-service/withNotificationService.js');
const appJson = JSON.parse(read('app.json')) as { expo: { plugins: unknown[]; ios: unknown } };

describe('push badge native contract', () => {
  it('the extension reads the same key and fields the server sends', () => {
    expect(swift).toContain(`static let key = "${PUSH_TEAM_BADGE_KEY}"`);
    const sent = buildPushTeamBadge('KC');
    for (const field of ['initials', 'fill', 'border', 'ink']) {
      expect(sent).toHaveProperty(field);
      expect(swift).toContain(`raw["${field}"]`);
    }
  });

  it('draws initials and colors only, with no network or image fetch', () => {
    expect(swift).not.toMatch(/URLSession|Data\(contentsOf|UIImage\(named|logo/i);
  });

  it('falls back to the unmodified content on every failure path', () => {
    expect(swift).toContain('finish(request.content)');
    expect(swift).toContain('serviceExtensionTimeWillExpire');
  });

  it('declares a user-notification service extension with the right principal class', () => {
    expect(plist).toContain('com.apple.usernotifications.service');
    expect(plist).toContain('$(PRODUCT_MODULE_NAME).NotificationService');
    expect(swift).toContain('final class NotificationService: UNNotificationServiceExtension');
  });

  it('is registered in app.json without changing the main bundle id', () => {
    expect(appJson.expo.plugins).toContain(
      './plugins/notification-service/withNotificationService',
    );
    expect(appJson.expo.ios).toMatchObject({ bundleIdentifier: 'com.fantasyfocus.app' });
    expect(plugin).toContain('`${appId}.${TARGET}`');
  });
});
