import { describe, expect, it } from 'vitest';
import {
  parseInstagramUsername,
  parseInstagramUsernameDetailed,
} from './parse-instagram-username';

describe('parseInstagramUsername', () => {
  it('accepts plain handle', () => {
    expect(parseInstagramUsername('figma')).toBe('figma');
  });

  it('accepts @handle', () => {
    expect(parseInstagramUsername('@figma')).toBe('figma');
  });

  it('accepts profile URL with tracking params', () => {
    expect(
      parseInstagramUsername(
        'https://www.instagram.com/figma?igsh=MWFqdm8yMmtzZjdhNA==',
      ),
    ).toBe('figma');
  });

  it('accepts profile URL without protocol', () => {
    expect(parseInstagramUsername('instagram.com/figma')).toBe('figma');
  });

  it('accepts profile URL with trailing slash', () => {
    expect(parseInstagramUsername('https://www.instagram.com/figma/')).toBe('figma');
  });

  it('accepts stories profile path', () => {
    expect(parseInstagramUsername('https://www.instagram.com/stories/figma/')).toBe(
      'figma',
    );
  });

  it('rejects post URLs', () => {
    expect(
      parseInstagramUsernameDetailed('https://www.instagram.com/p/ABC123xyz/'),
    ).toEqual({ username: '', kind: 'unsupported_url' });
  });

  it('rejects reel URLs', () => {
    expect(
      parseInstagramUsernameDetailed('https://www.instagram.com/reel/ABC123xyz/'),
    ).toEqual({ username: '', kind: 'unsupported_url' });
  });

  it('returns empty for blank input', () => {
    expect(parseInstagramUsername('   ')).toBe('');
  });
});
