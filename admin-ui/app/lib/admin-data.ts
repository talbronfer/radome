export type Instance = {
  id: string;
  name?: string;
  image: string;
  status: string;
  serviceName: string;
  namespace: string;
  containerPort: number;
};

export type AllowedImage = {
  id: number;
  name: string;
  dockerHubUrl: string;
  defaultPort: number;
  description: string;
  env: Record<string, string> | null;
};

export type User = {
  id: number;
  username: string;
  role: string;
};

export const tokenKey = "radome.token";

export const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3000";

const proxyBaseEnv = process.env.NEXT_PUBLIC_PROXY_BASE;
const proxyPort = process.env.NEXT_PUBLIC_PROXY_PORT ?? "8080";

const normalizeBase = (value: string) => value.replace(/\/$/, "");

const buildFallbackProxyBase = () => {
  try {
    const url = new URL(apiBase);
    url.port = proxyPort;
    return normalizeBase(url.toString());
  } catch {
    return `http://localhost:${proxyPort}`;
  }
};

export const proxyBase = normalizeBase(proxyBaseEnv ?? buildFallbackProxyBase());

export const buildProxyUrl = (instanceId: string, base = proxyBase) =>
  `${normalizeBase(base)}/instances/${instanceId}`;

export const parseEnvJson = (value: string) => {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Environment variables must be an object.");
  }
  const envPayload: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== "string") {
      throw new Error("Environment variable values must be strings.");
    }
    envPayload[key] = entry;
  }
  return envPayload;
};
