import { v4 as uuidv4 } from "uuid";
import { V1Deployment, V1Pod, V1Secret, V1Service } from "@kubernetes/client-node";
import type { AllowedImageRecord } from "./db.js";
import { appsApi, coreApi } from "./kube.js";

export type InstanceStatus = "starting" | "running" | "stopped" | "error";

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
  statusMessage?: string;
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
const dockerUsername = process.env.RADOME_DOCKER_USERNAME;
const dockerToken = process.env.RADOME_DOCKER_TOKEN;
const dockerSecretName = process.env.RADOME_DOCKER_SECRET_NAME ?? "radome-dockerhub";

const buildDockerConfig = () => {
  if (!dockerUsername || !dockerToken) {
    return null;
  }
  const auth = Buffer.from(`${dockerUsername}:${dockerToken}`).toString("base64");
  return {
    auths: {
      "https://index.docker.io/v1/": {
        username: dockerUsername,
        password: dockerToken,
        auth,
      },
    },
  };
};

const ensureDockerSecret = async () => {
  const dockerConfig = buildDockerConfig();
  if (!dockerConfig) {
    return null;
  }
  try {
    await coreApi.readNamespacedSecret(dockerSecretName, namespace);
    return dockerSecretName;
  } catch (_error) {
    const secret: V1Secret = {
      metadata: {
        name: dockerSecretName,
      },
      type: "kubernetes.io/dockerconfigjson",
      data: {
        ".dockerconfigjson": Buffer.from(JSON.stringify(dockerConfig)).toString("base64"),
      },
    };
    await coreApi.createNamespacedSecret(namespace, secret);
    return dockerSecretName;
  }
};

const getLatestPod = (pods: V1Pod[]) =>
  pods.reduce<V1Pod | null>((latest, pod) => {
    if (!latest) {
      return pod;
    }
    const latestTime = latest.metadata?.creationTimestamp
      ? new Date(latest.metadata.creationTimestamp).getTime()
      : 0;
    const currentTime = pod.metadata?.creationTimestamp
      ? new Date(pod.metadata.creationTimestamp).getTime()
      : 0;
    return currentTime > latestTime ? pod : latest;
  }, null);

const deriveStatusFromPod = (pod: V1Pod) => {
  const phase = pod.status?.phase ?? "Pending";
  const statusMessage = pod.status?.message || pod.status?.reason || undefined;
  const containerStatuses = pod.status?.containerStatuses ?? [];
  const waitingState = containerStatuses
    .map((status) => status.state?.waiting)
    .find(Boolean);
  const waitingReason = waitingState?.reason;
  const waitingMessage = waitingState?.message;

  if (waitingReason && ["ErrImagePull", "ImagePullBackOff", "InvalidImageName"].includes(waitingReason)) {
    return { status: "error" as const, statusMessage: waitingMessage || waitingReason };
  }

  if (phase === "Failed") {
    return { status: "error" as const, statusMessage: statusMessage };
  }

  if (phase === "Succeeded") {
    return { status: "stopped" as const, statusMessage: statusMessage };
  }

  if (phase === "Running") {
    const allReady = containerStatuses.length > 0 && containerStatuses.every((status) => status.ready);
    return {
      status: allReady ? ("running" as const) : ("starting" as const),
      statusMessage: waitingMessage || statusMessage,
    };
  }

  return {
    status: "starting" as const,
    statusMessage: waitingMessage || statusMessage,
  };
};

const refreshInstanceStatus = async (instance: InstanceRecord) => {
  try {
    const pods = await coreApi.listNamespacedPod(
      instance.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `radome.instance=${instance.id}`,
    );
    const latestPod = getLatestPod(pods.body.items);
    if (!latestPod) {
      return { ...instance, status: "starting", statusMessage: undefined };
    }
    const derived = deriveStatusFromPod(latestPod);
    return { ...instance, status: derived.status, statusMessage: derived.statusMessage };
  } catch (error) {
    return { ...instance, status: "error", statusMessage: (error as Error).message };
  }
};

export const listInstances = async () => {
  const currentInstances = Array.from(instances.values());
  const refreshed = await Promise.all(currentInstances.map((instance) => refreshInstanceStatus(instance)));
  refreshed.forEach((instance) => instances.set(instance.id, instance));
  return refreshed;
};

export const getInstance = (id: string) => instances.get(id);

export const createInstance = async (input: CreateInstanceInput) => {
  const id = uuidv4();
  const containerPort = input.containerPort ?? input.image.defaultPort;
  const deploymentName = `radome-agent-${id}`;
  const serviceName = `radome-agent-${id}`;
  const serviceHost = `${serviceName}.${namespace}.svc.cluster.local`;
  const imagePullSecretName = await ensureDockerSecret();

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
          imagePullSecrets: imagePullSecretName ? [{ name: imagePullSecretName }] : undefined,
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
    status: "starting",
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
