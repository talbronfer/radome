import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import httpProxy from "http-proxy";
import type { InstanceRecord } from "./instances.js";
import { getInstanceOrLoad } from "./instances.js";
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

const buildKubeServicePath = (instance: InstanceRecord | undefined, requestUrl: string | undefined) => {
  if (!instance) {
    return null;
  }
  const path = requestUrl ?? "/";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy`;
  return `${basePath}${normalizedPath === "/" ? "/" : normalizedPath}`;
};

const buildKubeServiceBasePath = (instance: InstanceRecord | undefined) => {
  if (!instance) {
    return null;
  }
  return `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy`;
};

const applyCorsHeaders = (
  headers: Record<string, string | string[] | undefined>,
  origin: string | undefined,
  requestHeaders: string | undefined,
) => {
  headers["access-control-allow-origin"] = origin ?? "*";
  headers["access-control-allow-credentials"] = "true";
  headers["access-control-allow-methods"] = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  headers["access-control-allow-headers"] =
    requestHeaders ?? "Content-Type, Authorization, X-Requested-With";
  headers.vary = "Origin";
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
  const proxy = httpProxy.createProxyServer({ target: kubeApiServer, agent, followRedirects: true });

  proxy.on("proxyReq", (proxyReq, req) => {
    const incomingHeaders = req.headers;
    Object.entries(headers).forEach(([key, value]) => {
      if (value === undefined) {
        return;
      }
      const normalizedKey = key.toLowerCase();
      if (incomingHeaders[normalizedKey] === undefined) {
        proxyReq.setHeader(key, value);
      }
    });
  });

  proxy.on("proxyRes", (proxyRes, req) => {
    applyCorsHeaders(
      proxyRes.headers as Record<string, string | string[] | undefined>,
      req.headers.origin,
      req.headers["access-control-request-headers"] as string | undefined,
    );
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
    void (async () => {
      if (req.method === "OPTIONS") {
        const responseHeaders: Record<string, string | string[] | undefined> = {};
        applyCorsHeaders(
          responseHeaders,
          req.headers.origin,
          req.headers["access-control-request-headers"] as string | undefined,
        );
        Object.entries(responseHeaders).forEach(([key, value]) => {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        });
        res.statusCode = 204;
        res.end();
        return;
      }

      const hostHeader = req.headers.host ?? "";
      const subdomain = extractSubdomain(hostHeader, baseDomain);
      const instancePath = extractInstancePath(req.url);

      const instanceId = instancePath?.instanceId ?? subdomain ?? null;

      if (!instanceId) {
        res.statusCode = 400;
        res.end("Missing instance identifier in subdomain or /instances/:id path.");
        return;
      }

      const instance = await getInstanceOrLoad(instanceId);
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
    })().catch((error) => {
      res.statusCode = 500;
      res.end(`Proxy error: ${(error as Error).message}`);
    });
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Radome proxy listening on ${port} for *.${baseDomain} and ${baseDomain}/instances/:id via Kubernetes API`);
  });

  return server;
};
