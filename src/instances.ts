import { v4 as uuidv4 } from "uuid";
import { V1Deployment, V1Service } from "@kubernetes/client-node";
import type { AllowedImageRecord } from "./db.js";
import { appsApi, coreApi } from "./kube.js";

export type InstanceStatus = "running" | "stopped" | "error";

export type InstanceRecord = {
  id: string;
  image: string;
  dockerHubUrl: string;
  containerPort: number;
  namespace: string;
  deploymentName: string;
  serviceName: string;
  serviceHost: string;
  createdAt: string;
  status: InstanceStatus;
  name?: string;
};

export type CreateInstanceInput = {
  image: AllowedImageRecord;
  containerPort?: number;
  name?: string;
  env?: Record<string, string>;
  command?: string[];
};

const instances = new Map<string, InstanceRecord>();
const namespace = process.env.RADOME_KUBE_NAMESPACE ?? "default";
const dockerHubUsername = process.env.RADOME_DOCKERHUB_USERNAME;
const dockerHubToken = process.env.RADOME_DOCKERHUB_TOKEN;
const dockerHubSecretName = "radome-dockerhub";

const shouldUseDockerHubAuth = Boolean(dockerHubUsername && dockerHubToken);

const isNotFoundError = (error: unknown) => {
  if (typeof error !== "object" || !error) {
    return false;
  }

  const response = (error as { response?: { statusCode?: number } }).response;
  return response?.statusCode === 404;
};

const ensureDockerHubSecret = async () => {
  if (!shouldUseDockerHubAuth) {
    return undefined;
  }

  try {
    await coreApi.readNamespacedSecret(dockerHubSecretName, namespace);
    return dockerHubSecretName;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const auth = Buffer.from(`${dockerHubUsername}:${dockerHubToken}`).toString("base64");
  const dockerConfig = {
    auths: {
      "https://index.docker.io/v1/": {
        username: dockerHubUsername,
        password: dockerHubToken,
        auth,
      },
    },
  };

  const dockerConfigJson = Buffer.from(JSON.stringify(dockerConfig)).toString("base64");

  await coreApi.createNamespacedSecret(namespace, {
    metadata: {
      name: dockerHubSecretName,
    },
    type: "kubernetes.io/dockerconfigjson",
    data: {
      ".dockerconfigjson": dockerConfigJson,
    },
  });

  return dockerHubSecretName;
};

export const listInstances = () => Array.from(instances.values());

export const getInstance = (id: string) => instances.get(id);

export const createInstance = async (input: CreateInstanceInput) => {
  const id = uuidv4();
  const containerPort = input.containerPort ?? input.image.defaultPort;
  const deploymentName = `radome-agent-${id}`;
  const serviceName = `radome-agent-${id}`;
  const serviceHost = `${serviceName}.${namespace}.svc.cluster.local`;
  const dockerHubSecret = await ensureDockerHubSecret();

  const deployment: V1Deployment = {
    metadata: {
      name: deploymentName,
      labels: {
        "radome.instance": id,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "radome.instance": id,
        },
      },
      template: {
        metadata: {
          labels: {
            "radome.instance": id,
          },
        },
        spec: {
          imagePullSecrets: dockerHubSecret ? [{ name: dockerHubSecret }] : undefined,
          containers: [
            {
              name: "agent",
              image: input.image.name,
              ports: [{ containerPort }],
              env: input.env
                ? Object.entries(input.env).map(([key, value]) => ({ name: key, value }))
                : undefined,
              command: input.command,
            },
          ],
        },
      },
    },
  };

  const service: V1Service = {
    metadata: {
      name: serviceName,
      labels: {
        "radome.instance": id,
      },
    },
    spec: {
      selector: {
        "radome.instance": id,
      },
      ports: [
        {
          port: containerPort,
          targetPort: containerPort,
        },
      ],
    },
  };

  await appsApi.createNamespacedDeployment(namespace, deployment);
  await coreApi.createNamespacedService(namespace, service);

  const record: InstanceRecord = {
    id,
    image: input.image.name,
    dockerHubUrl: input.image.dockerHubUrl,
    containerPort,
    namespace,
    deploymentName,
    serviceName,
    serviceHost,
    createdAt: new Date().toISOString(),
    status: "running",
    name: input.name,
  };

  instances.set(id, record);
  return record;
};

export const removeInstance = async (id: string) => {
  const instance = instances.get(id);
  if (!instance) {
    return false;
  }

  await coreApi.deleteNamespacedService(instance.serviceName, instance.namespace);
  await appsApi.deleteNamespacedDeployment(instance.deploymentName, instance.namespace);

  instances.delete(id);
  return true;
};
