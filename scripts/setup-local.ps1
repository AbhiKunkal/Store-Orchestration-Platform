# ─── Local Setup Script (PowerShell for Windows) ─────────────────
#
# Windows equivalent of setup-local.sh
# Prerequisites: Docker Desktop, kind, kubectl, helm

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗"
Write-Host "║  Store Platform — Local Setup (Windows)                   ║"
Write-Host "╚═══════════════════════════════════════════════════════════╝"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir

# Step 1: Create kind cluster
Write-Host ""
Write-Host "═══ Step 1/6: Creating kind cluster ═══"
$clusters = kind get clusters 2>$null
if ($clusters -match "store-platform") {
    Write-Host "Cluster 'store-platform' already exists, skipping..."
} else {
    kind create cluster --name store-platform --config kind-config.yaml
    Write-Host "Cluster created!"
}

# Step 2: Install NGINX Ingress Controller
Write-Host ""
Write-Host "═══ Step 2/6: Installing NGINX Ingress Controller ═══"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

Write-Host "Waiting for Ingress controller to be ready..."
kubectl wait --namespace ingress-nginx `
    --for=condition=ready pod `
    --selector=app.kubernetes.io/component=controller `
    --timeout=120s
Write-Host "Ingress controller ready!"

# Step 3: Build Docker images
Write-Host ""
Write-Host "═══ Step 3/6: Building Docker images ═══"
docker build -t store-api:latest -f docker/Dockerfile.api .
docker build -t store-dashboard:latest -f docker/Dockerfile.dashboard .
Write-Host "Images built!"

# Step 4: Load images into kind
Write-Host ""
Write-Host "═══ Step 4/6: Loading images into kind cluster ═══"
kind load docker-image store-api:latest --name store-platform
kind load docker-image store-dashboard:latest --name store-platform
Write-Host "Images loaded!"

# Step 5: Create platform namespace
Write-Host ""
Write-Host "═══ Step 5/6: Creating platform namespace ═══"
kubectl create namespace platform --dry-run=client -o yaml | kubectl apply -f -

# Step 6: Deploy platform via Helm
Write-Host ""
Write-Host "═══ Step 6/6: Deploying platform via Helm ═══"
helm upgrade --install platform ./helm/platform-chart `
    -f ./helm/platform-chart/values-local.yaml `
    --namespace platform `
    --wait `
    --timeout 5m

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗"
Write-Host "║  ✅ Setup Complete!                                       ║"
Write-Host "║                                                           ║"
Write-Host "║  Dashboard: http://dashboard.127.0.0.1.nip.io             ║"
Write-Host "║  API:       http://api.127.0.0.1.nip.io/api/health        ║"
Write-Host "║                                                           ║"
Write-Host "║  To check status:                                         ║"
Write-Host "║    kubectl get pods -n platform                           ║"
Write-Host "║                                                           ║"
Write-Host "║  To tear down:                                            ║"
Write-Host "║    kind delete cluster --name store-platform              ║"
Write-Host "╚═══════════════════════════════════════════════════════════╝"
