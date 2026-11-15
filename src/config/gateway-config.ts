export type ProfilesMode = 'static' | 'proxy';

type Env = Record<string, string | undefined>;

const DEFAULT_CORS_ORIGIN = '^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?$';

/**
 * Everything the gateway reads from the environment, validated once at start-up.
 * Service URLs are never hard-coded. The engine has no URL here: it is internal, and
 * the Flame Lab reaches it through the MCP service.
 */
export class GatewayConfig {
  /** Port the gateway listens on. */
  port!: number;
  /** MCP service base URL (/chat and /lab/*), e.g. http://mcp:8001 */
  mcpUrl!: string;
  /** Frontend container base URL. When null the gateway is API-only. */
  frontendUrl!: string | null;
  /** Still undecided: a static file behind the gateway, or a service route. Both work. */
  profilesMode!: ProfilesMode;
  /** Location of profiles.json when profilesMode is "static". */
  profilesPath!: string;
  /** Service that owns GET /profiles when profilesMode is "proxy". */
  profilesUpstream!: string;
  /** The Flame Lab's training CSV, served by GET /datasets/flex-training.csv. Relative to the working directory. */
  trainingDataPath!: string;
  /** How long to wait for the first byte of an answer that waits for the LLM: /chat and /lab/predict. */
  chatTimeoutMs!: number;
  /** How long to wait for the first byte of any other upstream answer. */
  upstreamTimeoutMs!: number;
  /** Largest request body the gateway forwards. */
  maxBodyBytes!: number;
  /** Origins allowed to call the API from another origin (the Vite dev server). */
  corsAllowedOrigin!: RegExp;

  static fromEnv(env: Env): GatewayConfig {
    const errors: string[] = [];

    const url = (name: string, required: boolean): string | null => {
      const raw = env[name]?.trim();
      if (!raw) {
        if (required)
          errors.push(`${name} is required (e.g. http://host:port)`);
        return null;
      }
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('unsupported protocol');
        }
      } catch {
        errors.push(`${name} must be an http(s) URL (got "${raw}")`);
        return null;
      }
      return raw.replace(/\/+$/, '');
    };

    const positiveInt = (name: string, fallback: number): number => {
      const raw = env[name]?.trim();
      if (!raw) return fallback;
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) {
        errors.push(`${name} must be a positive integer (got "${raw}")`);
        return fallback;
      }
      return value;
    };

    const config = new GatewayConfig();
    config.port = positiveInt('PORT', 3000);
    config.mcpUrl = url('MCP_URL', true) ?? '';
    config.frontendUrl = url('FRONTEND_URL', false);

    const mode = env.PROFILES_MODE?.trim() || 'static';
    if (mode !== 'static' && mode !== 'proxy') {
      errors.push(`PROFILES_MODE must be "static" or "proxy" (got "${mode}")`);
    }
    config.profilesMode = mode === 'proxy' ? 'proxy' : 'static';
    config.profilesPath = env.PROFILES_PATH?.trim() || '/data/profiles.json';
    config.profilesUpstream = url('PROFILES_UPSTREAM', false) ?? config.mcpUrl;
    // Kept in this repository (data/) and copied into the image: there is no database yet.
    config.trainingDataPath =
      env.TRAINING_DATA_PATH?.trim() || 'data/flex-training.csv';

    config.chatTimeoutMs = positiveInt('CHAT_TIMEOUT_MS', 120_000);
    config.upstreamTimeoutMs = positiveInt('UPSTREAM_TIMEOUT_MS', 30_000);
    config.maxBodyBytes = positiveInt('MAX_BODY_BYTES', 1_048_576);

    const origin = env.CORS_ALLOWED_ORIGIN_REGEX?.trim() || DEFAULT_CORS_ORIGIN;
    try {
      config.corsAllowedOrigin = new RegExp(origin);
    } catch {
      errors.push(
        `CORS_ALLOWED_ORIGIN_REGEX is not a valid regular expression`,
      );
      config.corsAllowedOrigin = new RegExp(DEFAULT_CORS_ORIGIN);
    }

    if (errors.length > 0) {
      throw new Error(
        `Invalid gateway configuration:\n- ${errors.join('\n- ')}`,
      );
    }
    return config;
  }
}
