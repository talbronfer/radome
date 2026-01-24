import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

export type KubeProxyConfig = {
  server: string;
  requestOptions: Record<string, unknown>;
};

const kubeConfigPath = process.env.RADOME_KUBE_CONFIG_PATH;
const kubeInsecureSkipTlsVerify = process.env.RADOME_KUBE_INSECURE_SKIP_TLS_VERIFY;

const kubeConfig = new KubeConfig();
if (kubeConfigPath) {
  kubeConfig.loadFromFile(kubeConfigPath);
} else {
  try {
    kubeConfig.loadFromCluster();
  } catch (error) {
    throw new Error(
      `Failed to load Kubernetes config from cluster. Set RADOME_KUBE_CONFIG_PATH to a kubeconfig file path. ${
        (error as Error).message
      }`,
    );
  }
}

export const getKubeProxyConfig = (): KubeProxyConfig => {
  const requestOptions: Record<string, unknown> = { headers: {} };
  kubeConfig.applyToRequest(requestOptions as never);
  if (kubeInsecureSkipTlsVerify?.toLowerCase() === "true" || kubeInsecureSkipTlsVerify === "1") {
    // SECURITY: This disables TLS certificate verification for the Kubernetes API server.
    // Use only in controlled environments where hostname validation is intentionally bypassed.
    requestOptions.rejectUnauthorized = false;
  }
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster?.server) {
    throw new Error("Unable to determine Kubernetes API server from kubeconfig.");
  }
  return {
    server: cluster.server,
    requestOptions,
  };
};

export { kubeConfig };
export const appsApi = kubeConfig.makeApiClient(AppsV1Api);
export const coreApi = kubeConfig.makeApiClient(CoreV1Api);
