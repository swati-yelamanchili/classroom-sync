export interface AppConfig {
  port: number;
  teacherPasscode: string;
  authSecret: string;
  clientOrigins: string[];
  cookieSecure: boolean;
  clientDistDir: string | null;
  /** Address students should use, when it cannot be worked out (reverse proxies, custom domains). */
  publicBaseUrl: string | null;
  /** Requests per minute, per IP. */
  rateLimits: { api: number; login: number; studentLookup: number };
  topicRecognitionProvider: string;
}

const DEV_SECRET = 'local-development-secret-change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const authSecret = env.AUTH_SECRET ?? DEV_SECRET;
  const teacherPasscode = env.TEACHER_PASSCODE ?? '';
  if (!teacherPasscode) {
    throw new Error('TEACHER_PASSCODE must be set. Copy .env.example to .env to get started.');
  }
  if (env.NODE_ENV === 'production' && authSecret === DEV_SECRET) {
    throw new Error('AUTH_SECRET must be changed from the development default in production.');
  }
  return {
    // API_PORT wins so that a PORT inherited from a shell or tool cannot collide with the dev client.
    port: Number(env.API_PORT ?? env.PORT ?? 4000),
    teacherPasscode,
    authSecret,
    clientOrigins: (env.CLIENT_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    cookieSecure: env.COOKIE_SECURE === 'true',
    clientDistDir: env.CLIENT_DIST_DIR ?? null,
    publicBaseUrl: env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || null,
    rateLimits: {
      api: Number(env.RATE_LIMIT_API ?? 1200),
      login: Number(env.RATE_LIMIT_LOGIN ?? 10),
      studentLookup: Number(env.RATE_LIMIT_STUDENT ?? 120),
    },
    topicRecognitionProvider: env.TOPIC_RECOGNITION_PROVIDER ?? 'disabled',
  };
}
