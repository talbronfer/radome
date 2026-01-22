import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

const kubeConfigString = process.env.RADOME_KUBE_CONFIG;

if (!kubeConfigString) {
  throw new Error("RADOME_KUBE_CONFIG must be set to a kubeconfig YAML string.");
}

const kubeConfig = new KubeConfig();
kubeConfig.loadFromString(kubeConfigString);

export const appsApi = kubeConfig.makeApiClient(AppsV1Api);
export const coreApi = kubeConfig.makeApiClient(CoreV1Api);
