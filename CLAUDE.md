# api-gateway: rules for Claude sessions

Read this repository's `README.md` before changing anything. Its route table is the reference
for the gateway. The workspace `ARCHITECTURE.md` is outdated: do not follow it.

- The gateway is a thin reverse proxy. No business logic, no schema validation, no
  response rewriting. If a task needs any of those, stop and ask: it belongs in a service.
- REST + JSON only. No GraphQL, no gRPC. Deployment is Docker Compose, not Kubernetes.
- Never parse or buffer bodies. `bodyParser` is disabled on purpose; forward with
  `ProxyService.forward`.
- Service URLs come from `GatewayConfig` (environment). Never hard-code a host or port.
- The `/chat` and `/lab` contracts belong to the MCP service (its README). Do not depend on
  them: the gateway forwards bodies as is and must keep working when they change.
  Where `profiles.json` is hosted is still undecided; `PROFILES_MODE` supports both options.
- Only `/chat` and `/lab/*` may reach the MCP service. Never expose the MCP protocol
  endpoint (`/mcp`). No route reaches the engine: it is internal, behind the MCP.
- A new top-level API prefix must be added to `API_PATH` in `src/app.setup.ts`; otherwise
  its GET routes fall through to the frontend.
- Every error the gateway produces uses `{ "error", "detail" }` via `sendGatewayError`.
- Every new or changed route needs a case in `test/app.e2e-spec.ts`. Run `pnpm lint`,
  `pnpm test` and `pnpm test:e2e` before finishing.
- No new runtime dependencies without asking. The proxy uses `node:http` only.
- If this code and the `README.md` disagree, point it out instead of silently following one.
