# 🏪 Kubernetes Store Orchestration Platform

A platform for provisioning and managing isolated WooCommerce stores on Kubernetes. Each store runs in its own namespace with dedicated WordPress, MySQL, and Ingress — fully automated via Helm.
  
> **Engine**: WooCommerce (fully implemented), MedusaJS (stubbed, architecture supports it)  
> **Key principle**: Same Helm charts, different values files. Zero code changes between local and production.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │     NGINX Ingress Controller (traffic routing)           │  │
│  │  dashboard.127.0.0.1.nip.io → Dashboard                 │  │
│  │  api.127.0.0.1.nip.io       → Backend API               │  │
│  │  store-xxx.127.0.0.1.nip.io → Store's WordPress         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │ platform (NS)  │  │ store-abc (NS) │  │ store-xyz (NS) │   │
│  │ ────────────── │  │ ────────────── │  │ ────────────── │   │
│  │ Dashboard      │  │ WordPress      │  │ WordPress      │   │
│  │ Backend API    │  │ WooCommerce    │  │ WooCommerce    │   │
│  │ SQLite (PVC)   │  │ MySQL (PVC)    │  │ MySQL (PVC)    │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Tech | Purpose |
|-----------|------|---------|
| **Dashboard** | React + Vite + nginx | User interface for store management |
| **Backend API** | Express + SQLite | REST API, orchestration via Helm CLI |
| **WooCommerce Chart** | Helm chart | Per-store WordPress + MySQL + Ingress |
| **Platform Chart** | Helm chart | Dashboard + API + RBAC deployment |

### Reliability Model

Provisioning is idempotent and crash-safe. Startup recovery reconciles platform state with Kubernetes workload reality.

---

## Prerequisites

- **Docker Desktop** ([download](https://www.docker.com/products/docker-desktop/))
- **kind** — Kubernetes in Docker
  ```bash
  # Windows (PowerShell)
  choco install kind
  # or download from https://kind.sigs.k8s.io/docs/user/quick-start/#installation
  ```
- **kubectl**
  ```bash
  choco install kubernetes-cli
  ```
- **Helm**
  ```bash
  choco install kubernetes-helm
  ```

---

## 🚀 Local Setup (kind)

### Option A: Automated Setup

```bash

# Clone the repository
git clone https://github.com/AbhiKunkal/Store-Orchestration-Platform.git && cd Store-Orchestration-Platform

# Run the setup script
# Linux/Mac:
bash scripts/setup-local.sh

# Windows (PowerShell as Admin):
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
```

### Option B: Step-by-Step

```bash
# 1. Create kind cluster with Ingress port mappings
kind create cluster --name store-platform --config kind-config.yaml

# 2. Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

# 3. Build Docker images
docker build -t store-api:latest -f docker/Dockerfile.api .
docker build -t store-dashboard:latest -f docker/Dockerfile.dashboard .

# 4. Load images into kind
kind load docker-image store-api:latest --name store-platform
kind load docker-image store-dashboard:latest --name store-platform

# 5. Deploy platform via Helm
kubectl create namespace platform
helm upgrade --install platform ./helm/platform-chart \
  -f ./helm/platform-chart/values-local.yaml \
  --namespace platform --wait --timeout 5m
```

### Verify Setup

```bash
# Check pods are running
kubectl get pods -n platform

# Test API
curl http://api.127.0.0.1.nip.io/api/health

# Open Dashboard
# http://dashboard.127.0.0.1.nip.io


```

### Run Tests
```bash
cd backend
npm test

```
## 📦 How to Create a Store and Place an Order

### 1. Create a Store
1. Open **http://dashboard.127.0.0.1.nip.io** in your browser
2. Click **"+ Create Store"**
3. Enter a name (e.g., "My Test Shop") and select **WooCommerce**
4. Click **Create** — status will show "Queued" → "Provisioning" → "Ready"
5. Provisioning typically takes 2–5 minutes depending on image pulls and cluster performance

### 2. Place an Order (Definition of Done)
1. Click the **Store URL** on the card (e.g., `http://store-abc.127.0.0.1.nip.io`)
2. Browse the storefront — sample products are pre-loaded
3. Click any product → **Add to Cart**
4. Click **View Cart** → **Proceed to Checkout**
5. Fill in billing details (test data is fine)
6. Select **Cash on Delivery** as payment method
7. Click **Place Order** — you'll see an order confirmation
8. Go to **Admin URL** (`/wp-admin`) → WooCommerce → Orders
9. ✅ Verify the order appears in the admin panel

### 3. Delete a Store
1. Click **Delete** on the store card
2. Confirm deletion
3. All resources (namespace, pods, PVCs, secrets) are cleaned up
4. Verify: `kubectl get ns` — store namespace should be gone

---


## 🏗️ VPS / Production Setup (k3s)

The same Helm charts work on a VPS — **zero code changes**. Only `values-prod.yaml` differs.

### Step 1: Provision a VPS

Any Linux VPS with 2+ vCPUs and 4GB+ RAM (DigitalOcean, Hetzner, AWS Lightsail).

```bash
# SSH into your VPS
ssh root@your-server-ip
```

### Step 2: Install k3s

```bash
# Single-command install (includes kubectl, containerd, Traefik ingress)
curl -sfL https://get.k3s.io | sh -

# If using NGINX ingress instead of Traefik:
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml

# Verify
kubectl get nodes  # Should show "Ready"
```

### Step 3: Install cert-manager (TLS)

```bash
# Install cert-manager for automatic Let's Encrypt certificates
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml

# Create a ClusterIssuer for Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@myplatform.com    # Replace with your email
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### Step 4: Push images to registry

```bash
# On your local machine:
docker tag store-api:latest your-registry/store-api:1.0.0
docker tag store-dashboard:latest your-registry/store-dashboard:1.0.0
docker push your-registry/store-api:1.0.0
docker push your-registry/store-dashboard:1.0.0
```

### Step 5: Deploy with production values

```bash
# On the VPS:
kubectl create namespace platform
helm upgrade --install platform ./helm/platform-chart \
  -f ./helm/platform-chart/values-prod.yaml \
  --namespace platform --create-namespace
```

### Local vs Production — What Changes

| Setting | Local (kind) | Production (k3s) |
|---------|-------------|-------------------|
| `domain` | `127.0.0.1.nip.io` | `myplatform.com` |
| `ingress.tls` | `false` | `true` (cert-manager) |
| `api.image` | `store-api:latest` | `registry/store-api:1.0.0` |
| `imagePullPolicy` | `IfNotPresent` | `Always` |
| `api.replicas` | `1` | `2` (HA) |
| `api.env.maxStores` | `10` | `50` |
| `autoscaling.enabled` | `false` | `true` (HPA) |
| `api.storage.className` | `""` (default) | `local-path` (k3s) |
| Secret management | Generated in-cluster | External secrets manager |

> **Key principle**: The Helm charts remain identical. All environment differences are expressed through values files — no code branches, no if-else for environments.
>
> Helm upgrade / rollback workflows remain identical across environments.

---

## 📡 API Reference

### Endpoints

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/health` | Health check | 200 |
| GET | `/api/stores` | List all stores | 200 |
| GET | `/api/stores/:id` | Get single store | 200 / 404 |
| POST | `/api/stores` | Create a store | 201 / 400 / 429 |
| DELETE | `/api/stores/:id` | Delete a store | 202 / 404 / 409 |
| POST | `/api/stores/:id/retry` | Retry failed provisioning | 202 / 404 / 409 |
| GET | `/api/audit?limit=N` | Audit log (default 100) | 200 |
| GET | `/api/metrics` | Platform metrics | 200 |

### Error Schema

All errors return a structured response:

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Cannot 'retry' a store in 'ready' state"
  }
}
```

Error codes: `MISSING_STORE_NAME`, `INVALID_STORE_NAME`, `INVALID_ENGINE`, `ENGINE_UNAVAILABLE`, `QUOTA_EXCEEDED`, `RATE_LIMIT_EXCEEDED`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `OPERATION_IN_PROGRESS`, `INVALID_JSON`, `INTERNAL_SERVER_ERROR`.

### Observability

The dashboard at `http://dashboard.127.0.0.1.nip.io` provides three tabs:

- **🏪 Stores** — Live store grid with status badges, URLs, and actions
- **📋 Activity Log** — Timestamped audit trail of all platform actions
- **📊 Metrics** — Store counts, provisioning duration stats, and recent failures

---

## 📁 Repository Structure

```
store-platform/
├── README.md                        # This file
├── SYSTEM_DESIGN.md                 # Architecture & tradeoffs
├── kind-config.yaml                 # Kind cluster configuration
├── .dockerignore
│
├── backend/                         # Express API + Orchestrator
│   ├── src/
│   │   ├── index.js                 # Server entry + startup recovery
│   │   ├── config.js                # Environment configuration
│   │   ├── db.js                    # SQLite (stores + audit + metrics)
│   │   ├── routes/stores.js         # REST API (lifecycle guards)
│   │   ├── services/
│   │   │   ├── provisioner.js       # Store lifecycle orchestrator
│   │   │   └── storeEngines/        # Pluggable engine architecture
│   │   │       ├── woocommerce.js   # ✅ Fully implemented
│   │   │       └── medusa.js        # 🔲 Stubbed
│   │   ├── middleware/              # Rate limiter, error handler
│   │   ├── __tests__/               # Unit & Integration tests
│   │   │   ├── unit/                # error, db, utils tests
│   │   │   └── integration/         # API endpoint tests
│   │   └── utils/
│   │       ├── helmClient.js        # Helm CLI wrapper
│   │       ├── kubectlClient.js     # kubectl CLI wrapper
│   │       └── apiError.js          # Structured error responses
│   └── package.json
│
├── dashboard/                       # React SPA
│   ├── src/
│   │   ├── App.jsx                  # Main app (tabs: Stores, Activity, Metrics)
│   │   ├── index.css                # Design system (dark theme)
│   │   └── api/stores.js            # API client
│   ├── nginx.conf                   # SPA routing + API proxy
│   └── package.json
│
├── helm/
│   ├── platform-chart/              # Platform deployment
│   │   ├── values.yaml
│   │   ├── values-local.yaml
│   │   ├── values-prod.yaml         # Production config (HPA, replicas, TLS)
│   │   └── templates/               # API + Dashboard + RBAC + HPA
│   │
│   └── woocommerce-chart/           # Per-store deployment
│       ├── values.yaml
│       └── templates/               # MySQL + WordPress + Ingress
│                                    # + NetworkPolicy + ResourceQuota + LimitRange
│
├── docker/
│   ├── Dockerfile.api
│   └── Dockerfile.dashboard
│
└── scripts/
    ├── setup-local.sh
    └── setup-local.ps1
```

---

## 🧹 Teardown

```bash
# Delete all stores (if any)
# Use the dashboard or API: DELETE /api/stores/:id

# Delete the cluster entirely
kind delete cluster --name store-platform
```

---

## License

This project is created as part of a hiring assessment and is owned by the author.

