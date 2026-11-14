import { GatewayConfig } from './gateway-config';

const required = { ML_URL: 'http://ml:8000', MCP_URL: 'http://mcp:8001' };

describe('GatewayConfig.fromEnv', () => {
  it('applies the defaults', () => {
    const config = GatewayConfig.fromEnv(required);
    expect(config).toMatchObject({
      port: 3000,
      mlUrl: 'http://ml:8000',
      mcpUrl: 'http://mcp:8001',
      frontendUrl: null,
      profilesMode: 'static',
      profilesPath: '/data/profiles.json',
      profilesUpstream: 'http://mcp:8001',
      chatTimeoutMs: 120_000,
      upstreamTimeoutMs: 30_000,
    });
  });

  it('removes trailing slashes from service URLs', () => {
    const config = GatewayConfig.fromEnv({
      ...required,
      ML_URL: 'http://ml:8000/',
      FRONTEND_URL: 'http://frontend:80//',
    });
    expect(config.mlUrl).toBe('http://ml:8000');
    expect(config.frontendUrl).toBe('http://frontend:80');
  });

  it('allows any localhost port by default and nothing else', () => {
    const { corsAllowedOrigin } = GatewayConfig.fromEnv(required);
    expect(corsAllowedOrigin.test('http://localhost:5173')).toBe(true);
    expect(corsAllowedOrigin.test('http://127.0.0.1:4173')).toBe(true);
    expect(corsAllowedOrigin.test('http://localhost.evil.example')).toBe(false);
    expect(corsAllowedOrigin.test('https://evil.example')).toBe(false);
  });

  it('reports every problem at once', () => {
    expect(() =>
      GatewayConfig.fromEnv({
        MCP_URL: 'mcp:8001',
        PROFILES_MODE: 'database',
        CHAT_TIMEOUT_MS: 'soon',
      }),
    ).toThrow(
      /ML_URL is required[\s\S]*MCP_URL must be an http\(s\) URL[\s\S]*PROFILES_MODE[\s\S]*CHAT_TIMEOUT_MS/,
    );
  });
});
