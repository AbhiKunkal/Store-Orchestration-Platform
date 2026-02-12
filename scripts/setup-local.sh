#!/bin/bash
# ─── Local Setup Script ──────────────────────────────────────────
#
# This script sets up the entire platform from scratch:
# 1. Creates a kind cluster
# 2. Installs NGINX Ingress Controller
# 3. Builds Docker images
# 4. Loads images into kind
# 5. Deploys the platform via Helm
#
# Prerequisites: docker, kind, kubectl, helm
#
# Usage: bash scripts/setup-local.sh

set -euo pipefail

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Store Platform — Local Setup                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ── Step 1: Create kind cluster ──
echo ""
echo "═══ Step 1/6: Creating kind cluster ═══"
if kind get clusters 2>/dev/null | grep -q "store-platform"; then
  echo "Cluster 'store-platform' already exists, skipping..."
else
  kind create cluster --name store-platform --config kind-config.yaml
  echo "Cluster created!"
fi

# ── Step 2: Install NGINX Ingress Controller ──
echo ""
echo "═══ Step 2/6: Installing NGINX Ingress Controller ═══"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "Waiting for Ingress controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
echo "Ingress controller ready!"

# ── Step 3: Build Docker images ──
echo ""
echo "═══ Step 3/6: Building Docker images ═══"
docker build -t store-api:latest -f docker/Dockerfile.api .
docker build -t store-dashboard:latest -f docker/Dockerfile.dashboard .
echo "Images built!"

# ── Step 4: Load images into kind ──
echo ""
echo "═══ Step 4/6: Loading images into kind cluster ═══"
kind load docker-image store-api:latest --name store-platform
kind load docker-image store-dashboard:latest --name store-platform
echo "Images loaded!"

# ── Step 5: Create platform namespace ──
echo ""
echo "═══ Step 5/6: Creating platform namespace ═══"
kubectl create namespace platform --dry-run=client -o yaml | kubectl apply -f -

# ── Step 6: Deploy platform via Helm ──
echo ""
echo "═══ Step 6/6: Deploying platform via Helm ═══"
helm upgrade --install platform ./helm/platform-chart \
  -f ./helm/platform-chart/values-local.yaml \
  --namespace platform \
  --wait \
  --timeout 5m

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  ✅ Setup Complete!                                       ║"
echo "║                                                           ║"
echo "║  Dashboard: http://dashboard.127.0.0.1.nip.io             ║"
echo "║  API:       http://api.127.0.0.1.nip.io/api/health        ║"
echo "║                                                           ║"
echo "║  To check status:                                         ║"
echo "║    kubectl get pods -n platform                           ║"
echo "║                                                           ║"
echo "║  To tear down:                                            ║"
echo "║    kind delete cluster --name store-platform              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
