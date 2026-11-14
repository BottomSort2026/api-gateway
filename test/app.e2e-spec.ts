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
  let ml: MockService;
  let mcp: MockService;
  let frontend: MockService;
  let dataDir: string;
  let app: NestExpressApplication;

  const baseEnv = (): Record<string, string> => ({
    ML_URL: ml.url,
    MCP_URL: `${mcp.url}/`, // a trailing slash must not break routing
    FRONTEND_URL: frontend.url,
    PROFILES_PATH: join(dataDir, 'profiles.json'),
    UPSTREAM_TIMEOUT_MS: '200',
    CHAT_TIMEOUT_MS: '200',
    MAX_BODY_BYTES: '1024',
  });

  beforeAll(async () => {
    [ml, mcp, frontend] = await Promise.all([
      startMockService('ml'),
      startMockService('mcp'),
      startMockService('frontend'),
    ]);
    dataDir = mkdtempSync(join(tmpdir(), 'gateway-'));
    app = await createGateway(baseEnv());
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([ml.close(), mcp.close(), frontend.close()]);
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

  describe('/ml', () => {
    it('GET /ml/model-info -> ML /model-info', async () => {
      const res = await gateway().get('/ml/model-info').expect(200);
      expect(res.body).toMatchObject({ service: 'ml', url: '/model-info' });
    });

    it('POST /ml/predict -> ML /predict, keeping the query string', async () => {
      const res = await gateway()
        .post('/ml/predict?explain=1')
        .send({ fuel: 'heptane', o2: 0.21 })
        .expect(200);
      const echo = res.body as Echo;
      expect(echo.url).toBe('/predict?explain=1');
      expect(JSON.parse(echo.body)).toEqual({ fuel: 'heptane', o2: 0.21 });
    });

    it('returns the service errors unchanged (e.g. FastAPI 422)', async () => {
      const res = await gateway()
        .post('/ml/predict?status=422')
        .send({})
        .expect(422);
      expect(res.body).toEqual({ detail: 'mock ml error 422' });
    });

    it('answers 404 JSON for any other /ml path', async () => {
      const res = await gateway().get('/ml/docs').expect(404);
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
        .get('/ml/model-info')
        .set('Origin', DEV_ORIGIN)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(DEV_ORIGIN);
    });

    it('does not allow other origins', async () => {
      const res = await gateway()
        .get('/ml/model-info')
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
      degraded = await createGateway({ ...baseEnv(), ML_URL: DOWN });
    });
    afterAll(() => degraded.close());

    it('answers 502 JSON on its routes only', async () => {
      const res = await request(degraded.getHttpServer())
        .post('/ml/predict')
        .send({})
        .expect(502);
      expect(res.body).toMatchObject({ error: 'upstream_unavailable' });

      await request(degraded.getHttpServer()).get('/health').expect(200);
      await request(degraded.getHttpServer())
        .post('/chat')
        .send({})
        .expect(200);
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
