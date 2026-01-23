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
| `RADOME_KUBE_CONFIG_PATH` | _required_ | Path to your kubeconfig YAML file (for example `$HOME/.kube/config`). |
| `RADOME_DB_PATH` | `./data/radome.db` | SQLite database path for users and images. |
| `RADOME_ADMIN_USERNAME` | `admin` | Seed admin username. |
| `RADOME_ADMIN_PASSWORD` | `radome` | Seed admin password. |
| `RADOME_DOCKERHUB_USERNAME` | _optional_ | Docker Hub username used for pulling private images. |
| `RADOME_DOCKERHUB_TOKEN` | _optional_ | Docker Hub personal access token for registry auth. |

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

This MVP expects `RADOME_KUBE_CONFIG_PATH` to be set and does not persist instance state across restarts.
