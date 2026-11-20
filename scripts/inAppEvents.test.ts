import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import events from '../docs/marketing/in-app-events/events.json' with { type: 'json' };

const assetDirectory = new URL('../docs/marketing/in-app-events/', import.meta.url);
const copyLimits = {
  referenceName: 64,
  eventName: 30,
  shortDescription: 50,
  longDescription: 120,
} as const;
const prohibitedCopy = /\b(?:nfl|stakes?|push(?:es)?|bet\s+now|locks?|odds|promos?)\b|\$\d/i;
const easternTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/;
const minute = 60_000;
const day = 24 * 60 * minute;

describe('App Store In-App Events', () => {
  it('lists both events with unique reference names', () => {
    expect(events.map((event) => event.referenceName)).toEqual([
      'Thanksgiving Week 2026',
      'Fantasy Playoffs 2026',
    ]);
    expect(new Set(events.flatMap((event) => Object.values(event.media))).size).toBe(4);
  });

  describe.each(events)('$referenceName', (event) => {
    it('keeps the copy within App Store limits and uses approved event settings', () => {
      for (const [field, limit] of Object.entries(copyLimits)) {
        const copy = event[field as keyof typeof copyLimits];
        expect(copy.trim(), field).not.toBe('');
        expect([...copy].length, field).toBeLessThanOrEqual(limit);
        expect(copy, field).not.toMatch(prohibitedCopy);
      }

      expect(event.badge).toBe('Live Event');
      expect(event.purpose).toBe('Appropriate for all users');
      expect(event.deepLink).toBe('pivot://');
      expect(event.inAppPurchaseRequired).toBe(false);
    });

    it('fits the event duration and publish window', () => {
      const dates = [event.publish, event.startET, event.endET];
      for (const date of dates) {
        expect(date).toMatch(easternTimestamp);
        expect(Number.isFinite(Date.parse(date))).toBe(true);
      }

      const publish = Date.parse(event.publish);
      const start = Date.parse(event.startET);
      const end = Date.parse(event.endET);
      expect(end - start).toBeGreaterThanOrEqual(15 * minute);
      expect(end - start).toBeLessThanOrEqual(31 * day);
      expect(start - publish).toBeGreaterThanOrEqual(0);
      expect(start - publish).toBeLessThanOrEqual(14 * day);
    });

    it.each([
      { kind: 'card', width: 1920, height: 1080 },
      { kind: 'details', width: 1080, height: 1920 },
    ] as const)('has a $width × $height $kind PNG', ({ kind, width, height }) => {
      const path = event.media[kind];
      expect(path).toMatch(new RegExp(`^[a-z0-9-]+/${kind}\\.png$`));
      const png = readFileSync(new URL(path, assetDirectory));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(8)).toBe(13);
      expect(png.toString('ascii', 12, 16)).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(height);
    });
  });
});
