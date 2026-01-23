import http from "http";
import https from "https";
import express, { NextFunction, Request, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
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

type ProxyContext = {
  instanceId: string;
  clientPrefix: string;
  serviceHost: string;
  servicePort: number;
  namespace: string;
  serviceName: string;
  mode: "cluster" | "apiserver";
  apiserverPrefix?: string;
  apiserverTarget?: string;
  apiserverHeaders?: Record<string, string>;
  apiserverAgent?: https.Agent;
};

type ProxyRequest = Request & { radomeProxyContext?: ProxyContext };

export const startProxy = (config: ProxyConfig) => {
  const { baseDomain, port, pathPrefix } = config;
  const normalizedClientPrefix = pathPrefix ? normalizePathPrefix(pathPrefix) : "";
  const proxyMode = config.mode ?? "cluster";
  const app = express();

  const resolveInstance = async (req: ProxyRequest, res: Response, next: NextFunction) => {
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
      res.status(400).send("Missing or invalid instance identifier.");
      return;
    }

    const instance = getInstance(instanceId);
    if (!instance) {
      res.status(404).send("Instance not found.");
      return;
    }

    const context: ProxyContext = {
      instanceId,
      clientPrefix: normalizedClientPrefix ? `${normalizedClientPrefix}/${instanceId}` : "",
      serviceHost: instance.serviceHost,
      servicePort: instance.containerPort,
      namespace: instance.namespace,
      serviceName: instance.serviceName,
      mode: proxyMode === "apiserver" ? "apiserver" : "cluster",
    };

    if (context.mode === "apiserver") {
      try {
        const cluster = kubeConfig.getCurrentCluster();
        if (!cluster) {
          res.status(500).send("Kubernetes cluster config not available.");
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
        context.apiserverTarget = cluster.server;
        context.apiserverHeaders = requestOptions.headers;
        context.apiserverAgent = agent;
        context.apiserverPrefix = `/api/v1/namespaces/${instance.namespace}/services/${instance.serviceName}:${instance.containerPort}/proxy`;
      } catch (error) {
        res.status(502).send(`Proxy error: ${(error as Error).message}`);
        return;
      }
    }

    req.radomeProxyContext = context;
    next();
  };

  const proxyMiddleware = createProxyMiddleware<ProxyRequest>({
    target: "http://localhost",
    changeOrigin: true,
    ws: true,
    router: (req) => {
      const context = req.radomeProxyContext;
      if (!context) {
        return "http://localhost";
      }
      if (context.mode === "apiserver") {
        return context.apiserverTarget ?? "http://localhost";
      }
      return `http://${context.serviceHost}:${context.servicePort}`;
    },
    pathRewrite: (path, req) => {
      const context = req.radomeProxyContext;
      if (!context || context.mode !== "apiserver") {
        return path;
      }
      return `${context.apiserverPrefix}${path}`;
    },
    onProxyReq: (proxyReq, req) => {
      const context = req.radomeProxyContext;
      if (!context || context.mode !== "apiserver") {
        return;
      }
      const headers = context.apiserverHeaders ?? {};
      for (const [key, value] of Object.entries(headers)) {
        proxyReq.setHeader(key, value);
      }
      if (context.apiserverAgent) {
        (proxyReq as typeof proxyReq & { agent?: https.Agent }).agent = context.apiserverAgent;
      }
    },
    onProxyRes: (proxyRes, req) => {
      const context = req.radomeProxyContext;
      if (!context || context.mode !== "apiserver") {
        return;
      }
      const locationHeader = proxyRes.headers.location;
      if (!locationHeader || !context.apiserverPrefix) {
        return;
      }
      const locationValue = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
      if (!locationValue) {
        return;
      }
      const rewriteLocation = (path: string) => {
        if (path.startsWith(context.apiserverPrefix ?? "")) {
          const suffix = path.slice(context.apiserverPrefix.length);
          const nextPath = `${context.clientPrefix}${suffix}`;
          return nextPath === "" ? "/" : nextPath;
        }
        if (path.startsWith("/") && !path.startsWith(context.clientPrefix)) {
          return context.clientPrefix ? `${context.clientPrefix}${path}` : path;
        }
        return null;
      };
      if (locationValue.startsWith("http://") || locationValue.startsWith("https://")) {
        const parsed = new URL(locationValue);
        const rewrittenPath = rewriteLocation(parsed.pathname);
        if (rewrittenPath) {
          proxyRes.headers.location = `${rewrittenPath}${parsed.search}${parsed.hash}`;
        }
      } else {
        const rewrittenPath = rewriteLocation(locationValue);
        if (rewrittenPath) {
          proxyRes.headers.location = rewrittenPath;
        }
      }
    },
    onError: (err, _req, res) => {
      res.statusCode = 502;
      res.end(`Proxy error: ${err?.message ?? "unknown"}`);
    },
  });

  app.use(resolveInstance);
  app.use(proxyMiddleware);

  const server = http.createServer(app);

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Radome proxy listening on ${port} for *.${baseDomain}`);
  });

  return server;
};
