import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

const kubeConfigPath = process.env.RADOME_KUBE_CONFIG_PATH;

if (!kubeConfigPath) {
  throw new Error("RADOME_KUBE_CONFIG_PATH must be set to a kubeconfig file path.");
}

const kubeConfig = new KubeConfig();
kubeConfig.loadFromFile(kubeConfigPath);

export const appsApi = kubeConfig.makeApiClient(AppsV1Api);
export const coreApi = kubeConfig.makeApiClient(CoreV1Api);
