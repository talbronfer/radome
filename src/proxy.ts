import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import httpProxy from "http-proxy";
import { getInstance } from "./instances.js";
import { kubeConfig } from "./kube.js";

export type ProxyConfig = {
  baseDomain: string;
  port: number;
  pathPrefix?: string;
  mode?: "cluster" | "apiserver";
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

const normalizePathPrefix = (pathPrefix: string) => {
  if (!pathPrefix.startsWith("/")) {
    return `/${pathPrefix}`;
  }
  return pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
};

const extractInstanceFromPath = (url: string, pathPrefix: string) => {
  const [path, query] = url.split("?");
  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  if (!path.startsWith(normalizedPrefix)) {
    return null;
  }
  const remainder = path.slice(normalizedPrefix.length);
  if (!remainder.startsWith("/")) {
    return null;
  }
  const trimmed = remainder.slice(1);
  const [instanceId, ...restSegments] = trimmed.split("/").filter(Boolean);
  if (!instanceId) {
    return null;
  }
  const restPath = restSegments.length > 0 ? `/${restSegments.join("/")}` : "/";
  const rewrittenUrl = query ? `${restPath}?${query}` : restPath;
  return { instanceId, rewrittenUrl };
};

export const startProxy = (config: ProxyConfig) => {
  const { baseDomain, port, pathPrefix } = config;
  const proxy = httpProxy.createProxyServer({});
  const normalizedClientPrefix = pathPrefix ? normalizePathPrefix(pathPrefix) : null;

  proxy.on("proxyRes", (proxyRes, req) => {
    const proxyContext = (req as IncomingMessage & {
      radomeProxyContext?: {
        apiserverPrefix: string;
        clientPrefix: string;
      };
    }).radomeProxyContext;
    if (!proxyContext) {
      return;
    }
    const locationHeader = proxyRes.headers.location;
    if (!locationHeader) {
      return;
    }
    const { apiserverPrefix, clientPrefix } = proxyContext;
    const locationValue = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
    if (!locationValue) {
      return;
    }
    const rewriteLocation = (path: string) => {
      if (!path.startsWith(apiserverPrefix)) {
        return null;
      }
      const suffix = path.slice(apiserverPrefix.length);
      const nextPath = `${clientPrefix}${suffix}`;
      return nextPath === "" ? "/" : nextPath;
    };
    try {
      if (locationValue.startsWith("http://") || locationValue.startsWith("https://")) {
        const parsed = new URL(locationValue);
        const rewrittenPath = rewriteLocation(parsed.pathname);
        if (rewrittenPath) {
          const rewrittenUrl = `${rewrittenPath}${parsed.search}${parsed.hash}`;
          proxyRes.headers.location = rewrittenUrl;
        }
      } else {
        const rewrittenPath = rewriteLocation(locationValue);
        if (rewrittenPath) {
          proxyRes.headers.location = rewrittenPath;
        }
      }
    } finally {
      delete (req as IncomingMessage & { radomeProxyContext?: unknown }).radomeProxyContext;
    }
  });

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const hostHeader = req.headers.host ?? "";
    const subdomain = extractSubdomain(hostHeader, baseDomain);
    let instanceId = subdomain;
    if (!instanceId && pathPrefix && req.url) {
      const match = extractInstanceFromPath(req.url, pathPrefix);
      if (match) {
        instanceId = match.instanceId;
        req.url = match.rewrittenUrl;
      }
    }

    if (!instanceId) {
      res.statusCode = 400;
      res.end("Missing or invalid instance identifier.");
      return;
    }

    const instance = getInstance(instanceId);
    if (!instance) {
      res.statusCode = 404;
      res.end("Instance not found.");
      return;
    }

    const respondProxyError = (err: Error | undefined) => {
      res.statusCode = 502;
      res.end(`Proxy error: ${err?.message ?? "unknown"}`);
    };

    const proxyMode = config.mode ?? "cluster";
    if (proxyMode === "apiserver") {
      void (async () => {
        try {
          const cluster = kubeConfig.getCurrentCluster();
          if (!cluster) {
            res.statusCode = 500;
            res.end("Kubernetes cluster config not available.");
            return;
          }
          const requestOptions: {
            headers?: Record<string, string>;
            cert?: Buffer;
            key?: Buffer;
            ca?: Buffer;
            strictSSL?: boolean;
            agentOptions?: https.AgentOptions;
          } = { headers: {} };
          await kubeConfig.applyToRequest(requestOptions as never);
          const secure = requestOptions.strictSSL !== false;
          const agent = new https.Agent({
            ca: requestOptions.ca,
            cert: requestOptions.cert,
            key: requestOptions.key,
            rejectUnauthorized: secure,
            ...(requestOptions.agentOptions ?? {}),
          });
          const proxyPath = `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy${req.url ?? ""}`;
          const clientPrefix = normalizedClientPrefix ? `${normalizedClientPrefix}/${instance.id}` : "";
          (req as IncomingMessage & {
            radomeProxyContext?: { apiserverPrefix: string; clientPrefix: string };
          }).radomeProxyContext = {
            apiserverPrefix: `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy`,
            clientPrefix,
          };
          req.url = proxyPath;
          proxy.web(
            req,
            res,
            {
              target: cluster.server,
              headers: requestOptions.headers,
              agent,
              secure,
              changeOrigin: true,
            },
            respondProxyError,
          );
        } catch (error) {
          respondProxyError(error as Error);
        }
      })();
      return;
    }

    proxy.web(
      req,
      res,
      { target: `http://${instance.serviceHost}:${instance.containerPort}` },
      respondProxyError,
    );
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Radome proxy listening on ${port} for *.${baseDomain}`);
  });

  return server;
};
