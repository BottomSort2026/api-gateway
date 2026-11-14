import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/** What a mock service saw, echoed back as JSON so tests can assert on it. */
export interface Echo {
  service: string;
  method: string;
  url: string;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export interface MockService {
  url: string;
  close: () => Promise<void>;
}

/**
 * A stand-in for a service behind the gateway. It echoes every request, except:
 *   ?slow=1    answers after 500 ms
 *   ?status=N  answers with status N and a FastAPI-style error body
 *   ?stream=1  answers with two chunks, 150 ms apart
 * It also sends its own CORS header, which the gateway must drop on API routes.
 */
export async function startMockService(service: string): Promise<MockService> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://mock');
      const echo: Echo = {
        service,
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
        headers: req.headers,
      };
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (url.searchParams.has('stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: one\n\n');
        setTimeout(() => res.end('data: two\n\n'), 150);
        return;
      }

      const status = Number(url.searchParams.get('status') ?? 200);
      const payload =
        status === 200 ? echo : { detail: `mock ${service} error ${status}` };
      const send = () => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (url.searchParams.has('slow')) setTimeout(send, 500);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
