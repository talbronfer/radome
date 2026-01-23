import http, { IncomingMessage, ServerResponse } from "http";
import httpProxy from "http-proxy";
import { getInstance } from "./instances.js";

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

export const startProxy = ({ baseDomain, port }: ProxyConfig) => {
  const proxy = httpProxy.createProxyServer({});

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
    console.log(`Radome proxy listening on ${port} for *.${baseDomain} and ${baseDomain}/instances/:id`);
  });

  return server;
};
