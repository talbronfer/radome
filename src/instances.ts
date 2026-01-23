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

export const listInstances = () => Array.from(instances.values());

export const getInstance = (id: string) => instances.get(id);

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
