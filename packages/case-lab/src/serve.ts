import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
});

/** Paths that must never be indexed; mirrors the `X-Robots-Tag` rules in vercel.json. */
const NOINDEX_PREFIXES = Object.freeze(['/result', '/api/']);

/** A minimal static server for local review and the acceptance test. It serves only files under the root. */
export function createStaticServer(rootDir: string): Server {
  const root = resolve(rootDir);
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    const robots = NOINDEX_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ? { 'X-Robots-Tag': 'noindex' } : {};
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    let size: number;
    try {
      const metadata = statSync(target);
      if (!metadata.isFile()) throw new Error('not a file');
      size = metadata.size;
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...robots,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(target).pipe(response);
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('server did not bind to a TCP port'));
        return;
      }
      resolvePort(address.port);
    });
  });
}
