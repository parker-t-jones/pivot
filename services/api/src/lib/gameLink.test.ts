import { describe, expect, it } from 'vitest';

import { parseGameLinkUrl } from './gameLink.js';

describe('parseGameLinkUrl', () => {
  it('accepts an https url and stores the parsed form', () => {
    expect(parseGameLinkUrl('https://www.primevideo.com/watch')).toEqual({
      url: 'https://www.primevideo.com/watch',
      host: 'www.primevideo.com',
    });
  });

  it('rejects non-https protocols', () => {
    expect(parseGameLinkUrl('http://example.com/watch')).toBeNull();
    expect(parseGameLinkUrl('javascript:alert(1)')).toBeNull();
    expect(parseGameLinkUrl('data:text/html,hi')).toBeNull();
    expect(parseGameLinkUrl('ftp://example.com/watch')).toBeNull();
  });

  it('rejects a url with a username and password', () => {
    expect(parseGameLinkUrl('https://user:pass@example.com/watch')).toBeNull();
  });

  it('rejects a url longer than 2048 characters', () => {
    const prefix = 'https://example.com/';
    const tooLong = prefix + 'a'.repeat(2049 - prefix.length);
    expect(tooLong).toHaveLength(2049);
    expect(parseGameLinkUrl(tooLong)).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseGameLinkUrl('  https://example.com/watch \n')).toEqual({
      url: 'https://example.com/watch',
      host: 'example.com',
    });
  });

  it('rejects a hostname with no dot', () => {
    expect(parseGameLinkUrl('https://localhost/watch')).toBeNull();
  });
});
