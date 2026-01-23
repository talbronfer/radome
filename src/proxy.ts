import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import httpProxy from "http-proxy";
import { getInstance } from "./instances.js";
import { getKubeProxyConfig } from "./kube.js";

export type ProxyConfig = {
  baseDomain: string;
  port: number;
};

const extractSubdomain = (host: string, baseDomain: string) => {
  const normalizedHost = host.split(":")[0].toLowerCase();
  const normalizedBase = baseDomain.toLowerCase();
  if (!normalizedHost.endsWith(normalizedBase)) {
    return null;
  }

  const prefix = normalizedHost.slice(0, -normalizedBase.length);
  if (!prefix.endsWith(".")) {
    return null;
  }
  const subdomain = prefix.slice(0, -1);
  return subdomain || null;
};

const extractInstancePath = (reqUrl: string | undefined) => {
  if (!reqUrl) {
    return null;
  }
  const parsed = new URL(reqUrl, "http://radome.local");
  const match = parsed.pathname.match(/^\/instances\/([^/]+)(\/.*)?$/);
  if (!match) {
    return null;
  }
  const instanceId = match[1];
  const restPath = match[2] ?? "/";
  return {
    instanceId,
    proxiedPath: `${restPath}${parsed.search}`,
  };
};

const buildKubeServicePath = (instance: ReturnType<typeof getInstance>, requestUrl: string | undefined) => {
  if (!instance) {
    return null;
  }
  const path = requestUrl ?? "/";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy`;
  return `${basePath}${normalizedPath === "/" ? "/" : normalizedPath}`;
};

const buildKubeServiceBasePath = (instance: ReturnType<typeof getInstance>) => {
  if (!instance) {
    return null;
  }
  return `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy`;
};

export const startProxy = ({ baseDomain, port }: ProxyConfig) => {
  const { server: kubeApiServer, requestOptions } = getKubeProxyConfig();
  const headers = (requestOptions.headers as Record<string, string>) ?? {};
  const agentOptions: https.AgentOptions = {
    ca: requestOptions.ca as string | Buffer | Array<string | Buffer> | undefined,
    cert: requestOptions.cert as string | Buffer | undefined,
    key: requestOptions.key as string | Buffer | undefined,
    rejectUnauthorized: requestOptions.rejectUnauthorized as boolean | undefined,
  };
  const agent = kubeApiServer.startsWith("https") ? new https.Agent(agentOptions) : undefined;
  const proxy = httpProxy.createProxyServer({ target: kubeApiServer, agent });

  proxy.on("proxyReq", (proxyReq) => {
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) {
        proxyReq.setHeader(key, value);
      }
    });
  });

  proxy.on("proxyRes", (proxyRes, req) => {
    const location = proxyRes.headers.location;
    const instanceId = (req as IncomingMessage & { radomeInstanceId?: string }).radomeInstanceId;
    const basePath = (req as IncomingMessage & { radomeBasePath?: string }).radomeBasePath;
    if (!location || !instanceId || !basePath) {
      return;
    }
    const locationValue = Array.isArray(location) ? location[0] : location;
    if (!locationValue) {
      return;
    }
    try {
      const parsed = new URL(locationValue, kubeApiServer);
      const path = parsed.pathname;
      if (!path.startsWith(basePath)) {
        return;
      }
      const suffix = path.slice(basePath.length);
      const proxiedPath = `/instances/${instanceId}${suffix || "/"}`;
      const rewritten = `${proxiedPath}${parsed.search}`;
      proxyRes.headers.location = rewritten;
    } catch {
      return;
    }
  });

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const hostHeader = req.headers.host ?? "";
    const subdomain = extractSubdomain(hostHeader, baseDomain);
    const instancePath = extractInstancePath(req.url);

    const instanceId = subdomain ?? instancePath?.instanceId ?? null;

    if (!instanceId) {
      res.statusCode = 400;
      res.end("Missing instance identifier in subdomain or /instances/:id path.");
      return;
    }

    const instance = getInstance(instanceId);
    if (!instance) {
      res.statusCode = 404;
      res.end("Instance not found.");
      return;
    }

    if (instancePath) {
      req.url = instancePath.proxiedPath;
    }

    const kubePath = buildKubeServicePath(instance, req.url);
    if (!kubePath) {
      res.statusCode = 500;
      res.end("Unable to build Kubernetes proxy path.");
      return;
    }

    const basePath = buildKubeServiceBasePath(instance);
    if (!basePath) {
      res.statusCode = 500;
      res.end("Unable to build Kubernetes base proxy path.");
      return;
    }

    (req as IncomingMessage & { radomeInstanceId?: string }).radomeInstanceId = instance.id;
    (req as IncomingMessage & { radomeBasePath?: string }).radomeBasePath = basePath;
    req.url = kubePath;

    proxy.web(
      req,
      res,
      {},
      (err) => {
        res.statusCode = 502;
        res.end(`Proxy error: ${err?.message ?? "unknown"}`);
      },
    );
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Radome proxy listening on ${port} for *.${baseDomain} and ${baseDomain}/instances/:id via Kubernetes API`);
  });

  return server;
};
