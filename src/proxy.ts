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

export const startProxy = ({ baseDomain, port }: ProxyConfig) => {
  const proxy = httpProxy.createProxyServer({});

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const hostHeader = req.headers.host ?? "";
    const subdomain = extractSubdomain(hostHeader, baseDomain);

    if (!subdomain) {
      res.statusCode = 400;
      res.end("Missing or invalid subdomain host header.");
      return;
    }

    const instance = getInstance(subdomain);
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
