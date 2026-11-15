# api-gateway

Single entry point of **Flame in Freefall** (NASA Space Apps 2026, team BottomSort).
A thin NestJS reverse proxy: it routes, sets CORS and returns JSON errors. It holds no
business logic and no knowledge of the request or response schemas.

This README is the reference for the gateway. The `/chat` and `/lab` contracts belong to
the MCP service and are described in its README.

## Routes

| Public route | Goes to | Used by |
|---|---|---|
| `GET /health` | answered by the gateway | Compose healthcheck |
| `GET /profiles` | `profiles.json` (static) or a service, see `PROFILES_MODE` | Library |
| `POST /chat` | `${MCP_URL}/chat` | Assistant |
| `POST /lab/predict` | `${MCP_URL}/lab/predict` | Flame Lab: one press of Predict |
| `GET /lab/model-info` | `${MCP_URL}/lab/model-info` | Flame Lab: the controls |
| any other `GET` | `${FRONTEND_URL}` (when set) | pages and assets |

- REST + JSON on both sides. Bodies are streamed, never parsed: the gateway does not
  change when the `/chat` or `/lab` contracts do, and a streamed chat answer passes
  through chunk by chunk.
- Only `/chat` and `/lab/*` reach the MCP. The MCP protocol endpoint (`/mcp`) is internal
  and is never exposed.
- The engine is internal: no route reaches it. The Flame Lab goes through the MCP, which
  calls the engine and adds the explanation and the real tests behind the prediction.
- `/health`, `/profiles`, `/chat` and `/lab` are reserved for the API: unknown paths
  under them are a JSON 404 and never fall through to the frontend. `/ml`, the Lab's old
  prefix, has no routes but stays reserved, so an old client gets a JSON 404 and not a page.
- Status codes and bodies returned by a service (for example the MCP's 422
  `invalid_inputs` or 502 `predict_unavailable`) are forwarded unchanged.
- `/chat` and `/lab/predict` wait for an LLM, so they get `CHAT_TIMEOUT_MS`. Every other
  route gets `UPSTREAM_TIMEOUT_MS`.

## Errors produced by the gateway

Always JSON, with CORS headers: `{ "error": "<code>", "detail": "<text>" }`.

| Status | `error` | Meaning |
|---|---|---|
| 502 | `upstream_unavailable` | The service behind the route is down or not resolvable |
| 504 | `upstream_timeout` | The service did not start answering in time |
| 413 | `payload_too_large` | Request body over `MAX_BODY_BYTES` |
| 404 | `profiles_not_built` | `PROFILES_MODE=static` and the file is missing |
| 404 | `not_found` | Unknown route |

The gateway starts and answers `/health` even when a service is down; only that
service's routes return 502.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MCP_URL` | yes | none | MCP service (`/chat` and `/lab/*`), e.g. `http://mcp:8001` |
| `FRONTEND_URL` | no | none (API-only) | Frontend container, e.g. `http://frontend:80` |
| `PORT` | no | `3000` | Port the gateway listens on |
| `PROFILES_MODE` | no | `static` | `static`: serve `PROFILES_PATH`. `proxy`: forward to `PROFILES_UPSTREAM` |
| `PROFILES_PATH` | no | `/data/profiles.json` | Offline-built profiles, mounted read-only |
| `PROFILES_UPSTREAM` | no | `MCP_URL` | Service that owns `GET /profiles` in `proxy` mode |
| `CHAT_TIMEOUT_MS` | no | `120000` | Wait for the first byte of a `/chat` or `/lab/predict` answer (both wait for the LLM) |
| `UPSTREAM_TIMEOUT_MS` | no | `30000` | Wait for the first byte of any other answer |
| `MAX_BODY_BYTES` | no | `1048576` | Largest request body forwarded |
| `CORS_ALLOWED_ORIGIN_REGEX` | no | any `http://localhost:<port>` | Origins allowed to call the API cross-origin |

The process exits at start with the full list of problems if the configuration is invalid.
`ML_URL`, `ENGINE_URL` and `DATA_PROVIDER_URL` are not read: no route needs them.

## Develop

```bash
pnpm install
cp .env.example .env      # set MCP_URL
pnpm start:dev            # http://localhost:3000

pnpm test                 # unit tests
pnpm test:e2e             # every route against mock services
pnpm lint
```

Frontend against a local gateway: run the Vite dev server with
`VITE_API_URL=http://localhost:3000`. The default CORS pattern already allows it.

## Docker and Compose

`pnpm-lock.yaml` must be committed: the image installs with `--frozen-lockfile`.

```bash
docker build -t flame-gateway .
```

Block for the root `compose.yaml`. Only the gateway publishes a port:

```yaml
services:
  gateway:
    build: ./api-gateway            # path to this repository
    ports:
      - "${GATEWAY_PORT:-8080}:3000"
    environment:
      MCP_URL: ${MCP_URL:-http://mcp:8001}
      FRONTEND_URL: ${FRONTEND_URL:-http://frontend:80}
      PROFILES_MODE: ${PROFILES_MODE:-static}
    volumes:
      - ${PROFILES_DIR:-./artifacts}:/data:ro   # folder that holds profiles.json
    restart: unless-stopped
```

## Rules for the services behind the gateway

- Do not add CORS headers. The gateway owns them and drops any that a service sends.
- Expose `GET /health`.
- Log the `X-Request-ID` header. The gateway logs the same id and returns it to the
  client, so one request can be followed across services.

## Layout

```
src/
  main.ts                       bootstrap
  app.setup.ts                  request id, CORS, frontend fallback (shared with the e2e tests)
  app.module.ts
  config/gateway-config.ts      environment, validated at start-up
  proxy/proxy.service.ts        streams a request to a service and the answer back
  chat/  lab/  profiles/  health/  one controller per public route group
  common/                       JSON error shape, exception filter, request id
test/
  app.e2e-spec.ts               every route, against mock services
  mock-service.ts
```

Adding a route: add a handler in the matching controller that calls `ProxyService.forward`
with the target URL from `GatewayConfig`, add a case to `test/app.e2e-spec.ts`, and add the
path prefix to `API_PATH` in `src/app.setup.ts` if it is a new top-level prefix.
