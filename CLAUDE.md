# api-gateway: rules for Claude sessions

Read `ARCHITECTURE.md` (§0 first) and this repository's `README.md` before changing anything.

- The gateway is a thin reverse proxy. No business logic, no schema validation, no
  response rewriting. If a task needs any of those, stop and ask: it belongs in a service.
- REST + JSON only. No GraphQL, no gRPC. Deployment is Docker Compose, not Kubernetes.
- Never parse or buffer bodies. `bodyParser` is disabled on purpose; forward with
  `ProxyService.forward`.
- Service URLs come from `GatewayConfig` (environment). Never hard-code a host or port.
- `/chat` schema, the prediction target and `profiles.json` hosting are OPEN in
  `ARCHITECTURE.md`. Do not assume them; the gateway must keep working whichever way they close.
- Only `/chat` may reach the MCP service. Never expose the MCP protocol endpoint.
- Every error the gateway produces uses `{ "error", "detail" }` via `sendGatewayError`.
- Every new or changed route needs a case in `test/app.e2e-spec.ts`. Run `pnpm lint`,
  `pnpm test` and `pnpm test:e2e` before finishing.
- No new runtime dependencies without asking. The proxy uses `node:http` only.
- If this code and `ARCHITECTURE.md` disagree, point it out instead of silently following one.
