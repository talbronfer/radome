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
const instanceLabelKey = "radome.instance";
const instanceNameAnnotation = "radome.name";

export const listInstances = () => Array.from(instances.values());

export const getInstance = (id: string) => instances.get(id);

const resolveInstanceId = (service?: V1Service, deployment?: V1Deployment) =>
  service?.metadata?.labels?.[instanceLabelKey] ?? deployment?.metadata?.labels?.[instanceLabelKey];

const resolveInstanceName = (service?: V1Service, deployment?: V1Deployment) =>
  service?.metadata?.annotations?.[instanceNameAnnotation] ??
  deployment?.metadata?.annotations?.[instanceNameAnnotation];

const resolveContainerPort = (service?: V1Service, deployment?: V1Deployment) =>
  service?.spec?.ports?.[0]?.port ??
  deployment?.spec?.template?.spec?.containers?.[0]?.ports?.[0]?.containerPort ??
  undefined;

const resolveImage = (deployment?: V1Deployment) =>
  deployment?.spec?.template?.spec?.containers?.[0]?.image;

const buildInstanceRecord = (service?: V1Service, deployment?: V1Deployment): InstanceRecord | null => {
  const instanceId = resolveInstanceId(service, deployment);
  if (!instanceId) {
    return null;
  }
  const serviceName = service?.metadata?.name ?? deployment?.metadata?.name ?? `radome-agent-${instanceId}`;
  const serviceNamespace = service?.metadata?.namespace ?? deployment?.metadata?.namespace ?? namespace;
  const containerPort = resolveContainerPort(service, deployment);
  const image = resolveImage(deployment);
  if (!containerPort || !image) {
    return null;
  }
  const createdAt =
    service?.metadata?.creationTimestamp ??
    deployment?.metadata?.creationTimestamp ??
    new Date().toISOString();
  const name = resolveInstanceName(service, deployment);
  return {
    id: instanceId,
    image,
    dockerHubUrl: image,
    containerPort,
    namespace: serviceNamespace,
    deploymentName: deployment?.metadata?.name ?? `radome-agent-${instanceId}`,
    serviceName,
    serviceHost: `${serviceName}.${serviceNamespace}.svc.cluster.local`,
    createdAt,
    status: "running",
    name,
  };
};

const hydrateInstance = async (id: string): Promise<InstanceRecord | undefined> => {
  const serviceName = `radome-agent-${id}`;
  const deploymentName = `radome-agent-${id}`;
  try {
    const [serviceResponse, deploymentResponse] = await Promise.all([
      coreApi.readNamespacedService(serviceName, namespace),
      appsApi.readNamespacedDeployment(deploymentName, namespace),
    ]);
    const record = buildInstanceRecord(serviceResponse.body, deploymentResponse.body);
    if (!record) {
      return undefined;
    }
    instances.set(id, record);
    return record;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      return undefined;
    }
    throw error;
  }
};

export const getInstanceOrLoad = async (id: string) => {
  const existing = getInstance(id);
  if (existing) {
    return existing;
  }
  return hydrateInstance(id);
};

export const syncInstancesFromCluster = async () => {
  const [serviceResponse, deploymentResponse] = await Promise.all([
    coreApi.listNamespacedService(namespace, undefined, undefined, undefined, undefined, instanceLabelKey),
    appsApi.listNamespacedDeployment(namespace, undefined, undefined, undefined, undefined, instanceLabelKey),
  ]);
  const deploymentsById = new Map<string, V1Deployment>();
  for (const deployment of deploymentResponse.body.items) {
    const instanceId = resolveInstanceId(undefined, deployment);
    if (instanceId) {
      deploymentsById.set(instanceId, deployment);
    }
  }
  const nextInstances = new Map<string, InstanceRecord>();
  for (const service of serviceResponse.body.items) {
    const instanceId = resolveInstanceId(service);
    if (!instanceId) {
      continue;
    }
    const deployment = deploymentsById.get(instanceId);
    const record = buildInstanceRecord(service, deployment);
    if (!record) {
      continue;
    }
    nextInstances.set(instanceId, record);
  }
  instances.clear();
  for (const [id, record] of nextInstances) {
    instances.set(id, record);
  }
};

export const createInstance = async (input: CreateInstanceInput) => {
  const id = uuidv4();
  const containerPort = input.containerPort ?? input.image.defaultPort;
  const mergedEnv = {
    ...(input.image.env ?? {}),
    ...(input.env ?? {}),
  };
  const envEntries = Object.entries(mergedEnv);
  const deploymentName = `radome-agent-${id}`;
  const serviceName = `radome-agent-${id}`;
  const serviceHost = `${serviceName}.${namespace}.svc.cluster.local`;

  const deployment: V1Deployment = {
    metadata: {
      name: deploymentName,
      annotations: input.name ? { [instanceNameAnnotation]: input.name } : undefined,
      labels: {
        [instanceLabelKey]: id,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          [instanceLabelKey]: id,
        },
      },
      template: {
        metadata: {
          annotations: input.name ? { [instanceNameAnnotation]: input.name } : undefined,
          labels: {
            [instanceLabelKey]: id,
          },
        },
        spec: {
          containers: [
            {
              name: "agent",
              image: input.image.name,
              ports: [{ containerPort }],
              env:
                envEntries.length > 0
                  ? envEntries.map(([key, value]) => ({ name: key, value }))
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
      annotations: input.name ? { [instanceNameAnnotation]: input.name } : undefined,
      labels: {
        [instanceLabelKey]: id,
      },
    },
    spec: {
      selector: {
        [instanceLabelKey]: id,
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
