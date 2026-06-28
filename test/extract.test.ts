import { describe, expect, it } from 'vitest';
import { extractLinks, getTitle, rewriteLinks } from '../src/extract.js';

describe('getTitle', () => {
  it('returns the title text', () => {
    expect(getTitle('<html><title>Hello</title></html>')).toBe('Hello');
  });
  it('collapses whitespace', () => {
    expect(getTitle('<title>  a\n  b </title>')).toBe('a b');
  });
  it('returns empty string when absent', () => {
    expect(getTitle('<html></html>')).toBe('');
  });
});

describe('extractLinks', () => {
  it('returns absolute, deduplicated hrefs resolved against the base', () => {
    const html = '<a href="/x">x</a><a href="https://y.com/z">z</a><a href="/x">dup</a>';
    expect(extractLinks(html, 'https://x.com/')).toEqual(['https://x.com/x', 'https://y.com/z']);
  });
});

describe('rewriteLinks', () => {
  it('repoints resolved internal links via the resolver', () => {
    const html = '<a href="https://x.com/about">About</a>';
    const out = rewriteLinks(html, 'https://x.com/', (abs) =>
      abs === 'https://x.com/about' ? 'about.html' : null,
    );
    expect(out).toContain('href="about.html"');
    expect(out).not.toContain('https://x.com/about');
  });
  it('leaves links the resolver does not claim untouched', () => {
    const html = '<a href="https://other.com/x">x</a>';
    const out = rewriteLinks(html, 'https://x.com/', () => null);
    expect(out).toContain('https://other.com/x');
  });
});
