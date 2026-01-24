# Radome MVP

Radome is a Kubernetes-based control plane for running agent containers. This MVP uses Kubernetes to provision agent or MCP containers from an allowed list of images, exposes each instance through a proxy, and provides a control API for lifecycle management.

## Features

- ✅ Allowed image list with DockerHub links
- ✅ Control API to create/list/delete agent instances
- ✅ Reverse proxy that exposes each instance via a dedicated subdomain
- ✅ Persisted users and allowed image catalog stored in SQLite
- ✅ Admin control panel UI for managing instances and images

## Getting Started

```bash
npm install
npm run dev
```

### Admin UI (Next.js)

```bash
cd admin-ui
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_BASE` to the control API base URL if it's not `http://localhost:3000`.

## Docker + Kubernetes (k3s) Deployment

Radome can run inside a remote k3s cluster using the included Helm chart. The control API and proxy run in one container; the admin UI is packaged separately.

### 1) Build and push images

Build and push images to a registry the k3s cluster can pull from (Docker Hub, GHCR, etc.).

```bash
# Control API + proxy
docker build -t <registry>/radome-api:0.1.0 .
docker push <registry>/radome-api:0.1.0

# Admin UI (build args set the public URLs baked into the Next.js bundle)
docker build -t <registry>/radome-admin-ui:0.1.0 \
  --build-arg NEXT_PUBLIC_API_BASE=https://radome.example.com \
  --build-arg NEXT_PUBLIC_PROXY_BASE=https://proxy.radome.example.com \
  ./admin-ui
docker push <registry>/radome-admin-ui:0.1.0
```

> **Note:** `NEXT_PUBLIC_API_BASE` and `NEXT_PUBLIC_PROXY_BASE` are embedded at build time for the admin UI. Rebuild the UI image when these URLs change.

### 2) SSH to the k3s server and install

```bash
ssh <user>@<k3s-host>
```

If Helm is not installed on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

Install or upgrade the Helm release:

```bash
kubectl create namespace radome || true

helm upgrade --install radome ./deploy/helm/radome \
  --namespace radome \
  --set image.repository=<registry>/radome-api \
  --set image.tag=0.1.0 \
  --set adminUi.image.repository=<registry>/radome-admin-ui \
  --set adminUi.image.tag=0.1.0 \
  --set radome.baseDomain=radome.example.com \
  --set radome.adminUiOrigin=https://admin.radome.example.com \
  --set adminUi.env.nextPublicApiBase=https://radome.example.com \
  --set adminUi.env.nextPublicProxyBase=https://proxy.radome.example.com \
  --set ingress.enabled=true \
  --set ingress.className=traefik \
  --set ingress.apiHost=radome.example.com \
  --set ingress.proxyHost=proxy.radome.example.com \
  --set ingress.adminHost=admin.radome.example.com
```

### 3) Access the services

- **Control API:** `https://radome.example.com`
- **Proxy:** `https://proxy.radome.example.com` (also used for `/instances/:id` paths)
- **Admin UI:** `https://admin.radome.example.com`

The control API uses in-cluster auth automatically, and the Helm chart grants permissions to create/delete deployments and services in the namespace.

### Local setup checklist

1. **Kubernetes cluster**: Start a local cluster (kind, minikube, or k3d) and ensure you can reach it with `kubectl get nodes`.
2. **Namespace** (optional): Create the namespace you'll use (defaults to `default`):
   ```bash
   kubectl create namespace radome
   ```
3. **Kubeconfig**: Point `RADOME_KUBE_CONFIG_PATH` at your kubeconfig file:
   ```bash
   export RADOME_KUBE_CONFIG_PATH="$HOME/.kube/config"
   export RADOME_KUBE_NAMESPACE="radome"
   ```
4. **Storage**: Ensure the `./data` directory is writable if you want persistence.

5. **Environment file** (optional): Create a `.env` file in the repo root and set your variables there (loaded automatically).

### Configuration

| Environment Variable | Default | Description |
| --- | --- | --- |
| `RADOME_CONTROL_PORT` | `3000` | Port for the control API. |
| `RADOME_PROXY_PORT` | `8080` | Port for the proxy that forwards traffic to instances. |
| `RADOME_BASE_DOMAIN` | `radome.local` | Base domain for instance subdomains. |
| `RADOME_KUBE_NAMESPACE` | `default` | Namespace for Radome-managed deployments/services. |
| `RADOME_KUBE_CONFIG_PATH` | _optional_ | Path to your kubeconfig YAML file (for example `$HOME/.kube/config`). Required when running outside the cluster. |
| `RADOME_KUBE_INSECURE_SKIP_TLS_VERIFY` | `false` | Set to `true` or `1` to disable TLS certificate verification when proxying to the Kubernetes API (unsafe; use only in controlled environments). |
| `RADOME_DB_PATH` | `./data/radome.db` | SQLite database path for users and images. |
| `RADOME_ADMIN_USERNAME` | `admin` | Seed admin username. |
| `RADOME_ADMIN_PASSWORD` | `radome` | Seed admin password. |
| `RADOME_ADMIN_UI_ORIGIN` | `http://localhost:3001` | Admin UI origin for CORS. |

### Control API

- `GET /health`
- `GET /images`
- `GET /instances`
- `POST /instances`
- `DELETE /instances/:id`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /users`
- `POST /users`
- `POST /images`
- `PUT /images/:id`
- `DELETE /images/:id`

Example create:

```bash
curl -X POST http://localhost:3000/instances \
  -H 'Content-Type: application/json' \
  -d '{"image":"langchain/langchain"}'
```

The response includes an `url` like `http://<id>.radome.local:8080` which forwards to the container.

### Admin UI

Visit `http://localhost:3001` (Next.js default) to sign in and manage instances, images, and users.

## Notes

This MVP requires a kubeconfig file when running outside the cluster and does not persist instance state across restarts.
