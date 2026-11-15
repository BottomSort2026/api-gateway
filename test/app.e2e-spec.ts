import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GatewayConfig } from '../src/config/gateway-config';
import { Echo, MockService, startMockService } from './mock-service';

const DEV_ORIGIN = 'http://localhost:5173';
/** A port nothing listens on: a service that is down. */
const DOWN = 'http://127.0.0.1:9';

async function createGateway(
  env: Record<string, string>,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GatewayConfig)
    .useValue(GatewayConfig.fromEnv(env))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

describe('API gateway (e2e)', () => {
  let mcp: MockService;
  let frontend: MockService;
  let dataDir: string;
  let app: NestExpressApplication;

  const baseEnv = (): Record<string, string> => ({
    MCP_URL: `${mcp.url}/`, // a trailing slash must not break routing
    FRONTEND_URL: frontend.url,
    PROFILES_PATH: join(dataDir, 'profiles.json'),
    UPSTREAM_TIMEOUT_MS: '200',
    CHAT_TIMEOUT_MS: '200',
    MAX_BODY_BYTES: '1024',
  });

  beforeAll(async () => {
    [mcp, frontend] = await Promise.all([
      startMockService('mcp'),
      startMockService('frontend'),
    ]);
    dataDir = mkdtempSync(join(tmpdir(), 'gateway-'));
    app = await createGateway(baseEnv());
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([mcp.close(), frontend.close()]);
    rmSync(dataDir, { recursive: true, force: true });
  });

  const gateway = () => request(app.getHttpServer());

  describe('GET /health', () => {
    it('answers without calling any service', async () => {
      const res = await gateway().get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', service: 'gateway' });
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('POST /chat', () => {
    it('forwards the body untouched to the MCP agent', async () => {
      const payload = { message: 'What is a cool flame?', history: [] };
      const res = await gateway().post('/chat').send(payload).expect(200);
      const echo = res.body as Echo;
      expect(echo.service).toBe('mcp');
      expect(echo.method).toBe('POST');
      expect(echo.url).toBe('/chat');
      expect(JSON.parse(echo.body)).toEqual(payload);
      expect(echo.headers['content-type']).toContain('application/json');
    });

    it('gives the service the same request id it returns to the client', async () => {
      const res = await gateway().post('/chat').send({}).expect(200);
      const echo = res.body as Echo;
      expect(echo.headers['x-request-id']).toBe(res.headers['x-request-id']);
    });

    it('keeps a request id sent by the client', async () => {
      const res = await gateway()
        .post('/chat')
        .set('X-Request-ID', 'demo-123')
        .send({})
        .expect(200);
      expect(res.headers['x-request-id']).toBe('demo-123');
      expect((res.body as Echo).headers['x-request-id']).toBe('demo-123');
    });

    it('passes a streamed answer through', async () => {
      const res = await gateway().post('/chat?stream=1').send({}).expect(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.text).toBe('data: one\n\ndata: two\n\n');
    });

    it('answers 504 JSON when the agent is too slow', async () => {
      const res = await gateway().post('/chat?slow=1').send({}).expect(504);
      expect(res.body).toMatchObject({ error: 'upstream_timeout' });
    });

    it('rejects a body over the limit with 413 JSON', async () => {
      const res = await gateway()
        .post('/chat')
        .send({ message: 'x'.repeat(2000) })
        .expect(413);
      expect(res.body).toMatchObject({ error: 'payload_too_large' });
    });

    it('does not route GET /chat or /chat/<anything> anywhere', async () => {
      const res = await gateway().get('/chat/tools').expect(404);
      expect(res.body).toMatchObject({ error: 'not_found' });
      await gateway().get('/chat').expect(404);
    });
  });

  describe('/lab (Flame Lab, through the MCP)', () => {
    const labRequest = {
      inputs: {
        fuel: 'methanol',
        pressure_atm: 1.0,
        o2: 0.21,
        suppressant: 'none',
        suppressant_fraction: 0.0,
        droplet_d0_mm: 3.0,
      },
      language: 'es',
    };

    it('POST /lab/predict -> MCP /lab/predict, body untouched and query string kept', async () => {
      const res = await gateway()
        .post('/lab/predict?trace=1')
        .send(labRequest)
        .expect(200);
      const echo = res.body as Echo;
      expect(echo.service).toBe('mcp');
      expect(echo.method).toBe('POST');
      expect(echo.url).toBe('/lab/predict?trace=1');
      expect(JSON.parse(echo.body)).toEqual(labRequest);
      expect(echo.headers['x-request-id']).toBe(res.headers['x-request-id']);
    });

    it('GET /lab/model-info -> MCP /lab/model-info, not the frontend', async () => {
      const res = await gateway().get('/lab/model-info').expect(200);
      expect(res.body).toMatchObject({
        service: 'mcp',
        method: 'GET',
        url: '/lab/model-info',
      });
    });

    it('returns the MCP errors unchanged (e.g. 422 invalid_inputs)', async () => {
      const res = await gateway()
        .post('/lab/predict?status=422')
        .send(labRequest)
        .expect(422);
      expect(res.body).toEqual({ detail: 'mock mcp error 422' });
    });

    it('answers 404 JSON for any other /lab path, never the frontend', async () => {
      const page = await gateway().get('/lab/docs').expect(404);
      expect(page.body).toMatchObject({ error: 'not_found' });
      const post = await gateway().post('/lab/explain').send({}).expect(404);
      expect(post.body).toMatchObject({ error: 'not_found' });
    });

    it('rejects a body over the limit with 413 JSON', async () => {
      const res = await gateway()
        .post('/lab/predict')
        .send({ ...labRequest, padding: 'x'.repeat(2000) })
        .expect(413);
      expect(res.body).toMatchObject({ error: 'payload_too_large' });
    });
  });

  describe('the engine and the MCP protocol stay internal', () => {
    it('no route reaches the engine: the old /ml routes are a JSON 404', async () => {
      const predict = await gateway().post('/ml/predict').send({}).expect(404);
      expect(predict.body).toMatchObject({ error: 'not_found' });
      const info = await gateway().get('/ml/model-info').expect(404);
      expect(info.body).toMatchObject({ error: 'not_found' });
    });

    it('does not expose the MCP protocol endpoint', async () => {
      const res = await gateway()
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(404);
      expect(res.body).toMatchObject({ error: 'not_found' });
    });
  });

  describe('GET /profiles (static)', () => {
    it('answers 404 JSON while profiles.json has not been built', async () => {
      const res = await gateway().get('/profiles').expect(404);
      expect(res.body).toMatchObject({ error: 'profiles_not_built' });
    });

    it('serves the file once it exists', async () => {
      const profiles = [{ accession: 'PSI-25', acronym: 'BASS-II' }];
      writeFileSync(join(dataDir, 'profiles.json'), JSON.stringify(profiles));
      const res = await gateway().get('/profiles').expect(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual(profiles);
    });
  });

  describe('CORS', () => {
    it('allows the Vite dev origin and drops the CORS headers of the service', async () => {
      const res = await gateway()
        .get('/lab/model-info')
        .set('Origin', DEV_ORIGIN)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
    });

    it('does not allow other origins', async () => {
      const res = await gateway()
        .get('/lab/model-info')
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers the preflight itself', async () => {
      const res = await gateway()
        .options('/chat')
        .set('Origin', DEV_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('sends CORS headers on gateway errors too', async () => {
      const res = await gateway()
        .post('/chat?slow=1')
        .set('Origin', DEV_ORIGIN)
        .send({})
        .expect(504);
      expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
    });
  });

  describe('frontend', () => {
    it('sends every non-API GET to the frontend, path and query intact', async () => {
      const res = await gateway()
        .get('/library?habitat=moon_base&fuel=solid')
        .expect(200);
      expect(res.body).toMatchObject({
        service: 'frontend',
        url: '/library?habitat=moon_base&fuel=solid',
      });
    });

    it('serves the root page from the frontend', async () => {
      const res = await gateway().get('/').expect(200);
      expect(res.body).toMatchObject({ service: 'frontend', url: '/' });
    });
  });

  describe('a service that is down', () => {
    let degraded: NestExpressApplication;

    beforeAll(async () => {
      degraded = await createGateway({ ...baseEnv(), MCP_URL: DOWN });
    });
    afterAll(() => degraded.close());

    it('answers 502 JSON on its routes only', async () => {
      const server = degraded.getHttpServer();
      for (const call of [
        request(server).post('/lab/predict').send({}),
        request(server).get('/lab/model-info'),
        request(server).post('/chat').send({}),
      ]) {
        const res = await call.expect(502);
        expect(res.body).toMatchObject({ error: 'upstream_unavailable' });
      }

      await request(server).get('/health').expect(200);
      const page = await request(server).get('/library').expect(200);
      expect(page.body).toMatchObject({ service: 'frontend' });
    });
  });

  describe('timeouts', () => {
    let timed: NestExpressApplication;

    beforeAll(async () => {
      // The mock answers ?slow=1 after 500 ms: longer than the default timeout, shorter
      // than the LLM timeout.
      timed = await createGateway({
        ...baseEnv(),
        UPSTREAM_TIMEOUT_MS: '200',
        CHAT_TIMEOUT_MS: '2000',
      });
    });
    afterAll(() => timed.close());

    it('POST /lab/predict waits as long as /chat: it waits for the LLM explanation', async () => {
      const res = await request(timed.getHttpServer())
        .post('/lab/predict?slow=1')
        .send({})
        .expect(200);
      expect(res.body).toMatchObject({
        service: 'mcp',
        url: '/lab/predict?slow=1',
      });
    });

    it('GET /lab/model-info keeps the short default timeout', async () => {
      const res = await request(timed.getHttpServer())
        .get('/lab/model-info?slow=1')
        .expect(504);
      expect(res.body).toMatchObject({ error: 'upstream_timeout' });
    });
  });

  describe('PROFILES_MODE=proxy', () => {
    let proxied: NestExpressApplication;

    beforeAll(async () => {
      proxied = await createGateway({ ...baseEnv(), PROFILES_MODE: 'proxy' });
    });
    afterAll(() => proxied.close());

    it('forwards GET /profiles to the MCP service by default', async () => {
      const res = await request(proxied.getHttpServer())
        .get('/profiles')
        .expect(200);
      expect(res.body).toMatchObject({ service: 'mcp', url: '/profiles' });
    });
  });

  describe('without FRONTEND_URL', () => {
    let apiOnly: NestExpressApplication;

    beforeAll(async () => {
      const env = baseEnv();
      delete env.FRONTEND_URL;
      apiOnly = await createGateway(env);
    });
    afterAll(() => apiOnly.close());

    it('is API-only: pages are a JSON 404', async () => {
      const res = await request(apiOnly.getHttpServer())
        .get('/library')
        .expect(404);
      expect(res.body).toMatchObject({ error: 'not_found' });
    });
  });
});
