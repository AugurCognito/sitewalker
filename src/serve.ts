import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

export interface ServeHandle {
  url: string;
  close: () => Promise<void>;
}

async function resolveFile(absRoot: string, urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  let filePath = path.join(absRoot, decoded);
  // Block path traversal outside the served root.
  if (filePath !== absRoot && !filePath.startsWith(absRoot + path.sep)) return null;

  let st = await stat(filePath).catch(() => null);
  if (st?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    st = await stat(filePath).catch(() => null);
  }
  return st?.isFile() ? filePath : null;
}

async function handleRequest(
  absRoot: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const filePath = await resolveFile(absRoot, req.url ?? '/');
    if (!filePath) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 Server Error');
  }
}

/** Serve a directory of static files (SPA-style index.html for directories). */
export function serve(root: string, port: number): Promise<ServeHandle> {
  const absRoot = path.resolve(root);
  const server = createServer((req, res) => {
    void handleRequest(absRoot, req, res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `http://localhost:${boundPort}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Open a URL in the default browser (best-effort, non-blocking). */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  // A normal foreground child: the OS opener hands off the URL and exits at
  // once, and the child dies with this process. No detached/unref — nothing is
  // left running invisibly.
  spawn(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32' }).on(
    'error',
    () => undefined,
  );
}
