import TurndownService from 'turndown';

let service: TurndownService | undefined;

function getService(): TurndownService {
  if (service) return service;
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  // SingleFile inlines images as base64 data: URIs. Keep the alt text but drop
  // the megabyte payload so the markdown stays readable for AI reference.
  td.addRule('inlinedImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as unknown as { getAttribute(name: string): string | null };
      const alt = el.getAttribute('alt') ?? '';
      const src = el.getAttribute('src') ?? '';
      if (!src || src.startsWith('data:')) return alt ? `![${alt}]` : '';
      return `![${alt}](${src})`;
    },
  });
  td.remove(['script', 'style', 'noscript']);
  service = td;
  return service;
}

/** Convert a (rendered, self-contained) HTML page to clean markdown. */
export function htmlToMarkdown(html: string): string {
  return getService().turndown(html).trim();
}
