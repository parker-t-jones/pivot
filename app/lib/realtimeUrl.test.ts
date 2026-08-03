import { describe, expect, it } from 'vitest';

import { buildRealtimeWsUrl } from './realtimeUrl';

describe('buildRealtimeWsUrl', () => {
  it('builds ws://…/v1/realtime without doubling /v1 (base has no trailing slash)', () => {
    expect(buildRealtimeWsUrl('http://127.0.0.1:3000', 'tok')).toBe(
      'ws://127.0.0.1:3000/v1/realtime?token=tok',
    );
  });

  it('strips a trailing slash on the API base so /v1 is not doubled', () => {
    expect(buildRealtimeWsUrl('http://127.0.0.1:3000/', 'tok')).toBe(
      'ws://127.0.0.1:3000/v1/realtime?token=tok',
    );
  });

  it('maps https → wss', () => {
    expect(buildRealtimeWsUrl('https://api.example.com', 'abc')).toBe(
      'wss://api.example.com/v1/realtime?token=abc',
    );
  });

  it('rejects non-http(s) bases', () => {
    expect(() => buildRealtimeWsUrl('ftp://x', 't')).toThrow(/http\(s\)/);
  });
});
