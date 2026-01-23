import http, { IncomingMessage, ServerResponse } from "http";
import httpProxy from "http-proxy";
import { getInstance } from "./instances.js";

export type ProxyConfig = {
  baseDomain: string;
  port: number;
  pathPrefix?: string;
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

export const startProxy = ({ baseDomain, port, pathPrefix }: ProxyConfig) => {
  const proxy = httpProxy.createProxyServer({});

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

    proxy.web(
      req,
      res,
      { target: `http://${instance.serviceHost}:${instance.containerPort}` },
      (err) => {
        res.statusCode = 502;
        res.end(`Proxy error: ${err?.message ?? "unknown"}`);
      },
    );
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Radome proxy listening on ${port} for *.${baseDomain}`);
  });

  return server;
};
