import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/markdown.js';

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    expect(htmlToMarkdown('<h1>Hi</h1><p>Body text</p>')).toBe('# Hi\n\nBody text');
  });

  it('strips inlined data: image payloads but keeps alt text', () => {
    const md = htmlToMarkdown('<img alt="a cat" src="data:image/png;base64,AAAABBBBCCCC">');
    expect(md).toBe('![a cat]');
    expect(md).not.toContain('data:');
  });

  it('keeps normal image URLs', () => {
    expect(htmlToMarkdown('<img alt="logo" src="https://x.com/logo.png">')).toBe(
      '![logo](https://x.com/logo.png)',
    );
  });

  it('drops scripts and styles', () => {
    const md = htmlToMarkdown('<style>.a{color:red}</style><p>keep</p><script>evil()</script>');
    expect(md).toBe('keep');
  });
});
