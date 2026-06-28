import { describe, expect, it } from 'vitest';
import {
  inScope,
  isProbablyPage,
  normalizeUrl,
  relHref,
  sameHost,
  siteScope,
  urlToRelPath,
} from '../src/urls.js';

describe('normalizeUrl', () => {
  it('drops the fragment', () => {
    expect(normalizeUrl('https://x.com/a#section')).toBe('https://x.com/a');
  });
  it('resolves against a base', () => {
    expect(normalizeUrl('/about', 'https://x.com/page')).toBe('https://x.com/about');
  });
  it('canonicalizes a trailing /index.html to the directory', () => {
    expect(normalizeUrl('https://x.com/index.html')).toBe('https://x.com/');
    expect(normalizeUrl('https://x.com/a/index.html')).toBe('https://x.com/a/');
  });
  it('rejects non-http(s) protocols', () => {
    expect(normalizeUrl('mailto:a@b.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('sameHost', () => {
  it('matches identical hosts (case-insensitive)', () => {
    expect(sameHost('https://X.com/a', 'x.com')).toBe(true);
  });
  it('rejects different hosts, including subdomains', () => {
    expect(sameHost('https://y.com/a', 'x.com')).toBe(false);
    expect(sameHost('https://www.x.com/a', 'x.com')).toBe(false);
  });
});

describe('isProbablyPage', () => {
  it('treats asset extensions as non-pages', () => {
    expect(isProbablyPage('https://x.com/a.jpg')).toBe(false);
    expect(isProbablyPage('https://x.com/style.css')).toBe(false);
    expect(isProbablyPage('https://x.com/doc.pdf')).toBe(false);
  });
  it('treats extensionless / html paths as pages', () => {
    expect(isProbablyPage('https://x.com/about')).toBe(true);
    expect(isProbablyPage('https://x.com/')).toBe(true);
    expect(isProbablyPage('https://x.com/a.html')).toBe(true);
  });
});

describe('urlToRelPath', () => {
  it('maps the homepage to <host>/index.html', () => {
    expect(urlToRelPath('https://x.com/')).toBe('x.com/index.html');
  });
  it('adds .html to extensionless pages', () => {
    expect(urlToRelPath('https://x.com/about')).toBe('x.com/about.html');
  });
  it('maps directory URLs to index.html', () => {
    expect(urlToRelPath('https://x.com/a/b/')).toBe('x.com/a/b/index.html');
  });
  it('encodes the query string into the filename', () => {
    expect(urlToRelPath('https://x.com/search?q=1')).toBe('x.com/search__q_1.html');
  });
});

describe('relHref', () => {
  it('links between siblings', () => {
    expect(relHref('x.com/index.html', 'x.com/about.html')).toBe('about.html');
  });
  it('links up out of a subdirectory', () => {
    expect(relHref('x.com/a/b.html', 'x.com/c.html')).toBe('../c.html');
  });
});

describe('inScope (default: apex ⇆ www)', () => {
  const scope = siteScope('https://example.com/', false);
  it('treats apex and www as the same site', () => {
    expect(inScope('https://example.com/x', scope)).toBe(true);
    expect(inScope('https://www.example.com/x', scope)).toBe(true);
  });
  it('excludes other subdomains and other domains', () => {
    expect(inScope('https://product.example.com/x', scope)).toBe(false);
    expect(inScope('https://other.com/x', scope)).toBe(false);
  });
  it('normalizes a www start host to the apex', () => {
    const fromWww = siteScope('https://www.example.com/', false);
    expect(inScope('https://example.com/x', fromWww)).toBe(true);
  });
});

describe('inScope (includeSubdomains)', () => {
  const scope = siteScope('https://example.com/', true);
  it('includes any subdomain of the registrable domain', () => {
    expect(inScope('https://product.example.com/x', scope)).toBe(true);
    expect(inScope('https://www.example.com/x', scope)).toBe(true);
    expect(inScope('https://example.com/x', scope)).toBe(true);
  });
  it('excludes look-alike domains', () => {
    expect(inScope('https://notexample.com/x', scope)).toBe(false);
    expect(inScope('https://example.com.evil.com/x', scope)).toBe(false);
  });
});
