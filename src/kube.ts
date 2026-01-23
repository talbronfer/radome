import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

export type KubeProxyConfig = {
  server: string;
  requestOptions: Record<string, unknown>;
};

const kubeConfigPath = process.env.RADOME_KUBE_CONFIG_PATH;

if (!kubeConfigPath) {
  throw new Error("RADOME_KUBE_CONFIG_PATH must be set to a kubeconfig file path.");
}

const kubeConfig = new KubeConfig();
kubeConfig.loadFromFile(kubeConfigPath);

export const getKubeProxyConfig = (): KubeProxyConfig => {
  const requestOptions: Record<string, unknown> = { headers: {} };
  kubeConfig.applyToRequest(requestOptions as never);
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
