# System Design & Tradeoffs

## Architecture Choice

**Monolithic API with inline orchestration** over microservices or operator pattern.

### Why?
- **Simplicity**: Single Express server handles API + orchestration
- **Debuggability**: All logic in one place, standard Node.js debugging
- **Explainability**: No hidden state machines or CRD reconciliation loops
- **Interview-safe**: Can walk through entire flow in one codebase

### Reliability Model

The platform is designed for eventual consistency between platform state and Kubernetes workload state.

### Production evolution path:
1. **Queue-backed orchestration**: Extract provisioning into a BullMQ worker backed by Redis
2. **Kubernetes Operator**: For true reconciliation with CRDs (most complex, most robust)
3. **ArgoCD/FluxCD**: GitOps-based provisioning for audit trails

---

## Idempotency & Failure Handling

### What makes provisioning idempotent:
1. **Helm release check**: Before install, check if release exists → skip if yes
2. **Namespace check**: Before creating, check if namespace exists → skip if yes
3. **Status-driven**: Each operation checks current status before acting
4. **Async provisioning**: Helm creates resources, provisioner polls readiness independently (no `--atomic` — avoids premature rollback on slow init jobs)

### Failure scenarios:

| Scenario | Handling |
|----------|----------|
| API crashes mid-provision | `recoverOnStartup()` detects stuck stores, checks pod readiness, marks ready or failed |
| Helm install fails | Status → "failed" with error message, release cleaned up |
| MySQL pod CrashLoopBackOff | Detected during readiness polling, status → "failed" with K8s events |
| Delete fails partway | Namespace delete cascades — catches orphaned resources |
| Duplicate create request | UUID-based IDs prevent collision; rate limiter prevents spam |
| Provisioning timeout | 10-minute deadline; auto-fails if exceeded |
| Invalid state transition | Lifecycle guards reject retry on ready stores, delete on deleted stores |

### Retry safety:
- Retry re-runs provisioning from step 1
- Each step checks state before acting
- No duplicate resources created
- User sees clear "why it failed" reporting

---

## Startup Recovery (Reconciliation Pattern)

On every API boot, `recoverOnStartup()` runs a reconciliation loop:

1. Query all stores with status `provisioning` or `queued`
2. For each stuck store, check if K8s pods are actually ready
3. If pods ready → mark store as `ready` (provisioning completed while API was down)
4. If pods not ready → mark as `failed` with message "API restarted during provisioning"
5. All transitions logged to audit trail

This follows the reconciliation principle used by Kubernetes controllers: continuously compare persisted desired state with cluster reality and converge.

---

## Cleanup Approach

**Namespace-based cascade deletion**:

1. `helm uninstall` removes chart-managed resources
2. `kubectl delete namespace` catches anything remaining
3. Database record marked "deleted"

This is intentionally belt-and-suspenders. Even if Helm uninstall fails, namespace deletion removes ALL resources in that namespace (Pods, Services, PVCs, Secrets, Ingress).

---

## Multi-Tenant Isolation

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Namespace** | One per store | Logical isolation |
| **NetworkPolicy** | Deny-by-default | MySQL not reachable cross-store |
| **ResourceQuota** | Per-namespace limits | Blast radius control |
| **LimitRange** | Default container limits | Prevent unbounded resource use |
| **Secrets** | Per-namespace, auto-generated | No shared credentials |

---

## Security Posture

### Secrets
- MySQL passwords: generated per-store, stored in K8s Secrets
- WP admin password: generated per-store, passed via Helm values
- **No hardcoded secrets in source code**
- Production: integrate with external secret managers (Vault, AWS SM)

### RBAC
- API uses a dedicated ServiceAccount (`store-api`)
- ClusterRole with least-privilege: namespace CRUD + resource management
- **NOT cluster-admin** — cannot modify system components

### Container Hardening
- API: `node:22-alpine` → smaller attack surface
- Dashboard: `nginx:alpine` → minimal base
- Non-root user in API Dockerfile
- Health checks on all pods

### Network Security
- MySQL: ClusterIP only (never exposed externally)
- WordPress: only reachable via Ingress
- NetworkPolicy: deny-by-default with explicit allows
- API: rate-limited (30 req/min general, 5 req/min for creates)

---

## Observability

### Dashboard Tabs
The React dashboard provides three views:

| Tab | Content |
|-----|--------|
| **Stores** | Store cards with status badges, URLs, delete/retry actions |
| **Activity Log** | Timestamped audit entries: create, delete, status change, retry, recovery |
| **Metrics** | Store counts by status, provisioning duration stats (avg/min/max), recent failures |

### API Endpoints for Observability

| Endpoint | Purpose |
|----------|---------|
| `GET /api/audit?limit=100` | Audit log: who did what, when |
| `GET /api/metrics` | Aggregated metrics: store counts, provisioning stats, failures |
| `GET /api/health` | Liveness check |

### "Why It Failed" Reporting
Every failure stores a specific `error_message`:
- Helm errors with exact CLI output
- Pod crash reasons with K8s event summaries
- Timeout messages with elapsed duration
- Recovery messages after API restart

These are surfaced in the store card UI and the Metrics panel's "Recent Failures" section.

---

## Structured Error Responses

All API errors follow a consistent schema:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

| Code | HTTP Status | When |
|------|------------|------|
| `MISSING_STORE_NAME` | 400 | POST /stores with empty name |
| `INVALID_ENGINE` | 400 | Unknown engine type |
| `ENGINE_UNAVAILABLE` | 400 | Engine not yet implemented (medusa) |
| `QUOTA_EXCEEDED` | 429 | Max stores limit reached |
| `NOT_FOUND` | 404 | Store ID doesn't exist |
| `INVALID_STATE_TRANSITION` | 409 | Retry on ready store, delete on deleted store |
| `OPERATION_IN_PROGRESS` | 409 | Concurrent operation on same store |
| `INVALID_JSON` | 400 | Malformed request body |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

Success responses are unchanged — only errors are standardized.

---

## What Changes for Production

| Aspect | Local (kind) | Production (k3s/VPS) |
|--------|-------------|----------------------|
| **Domain** | `*.127.0.0.1.nip.io` | `*.myplatform.com` |
| **TLS** | None | cert-manager + Let's Encrypt |
| **Storage class** | `standard` (kind default) | `local-path` or cloud PV |
| **Image source** | Local build + `kind load` | Container registry |
| **Secrets** | Helm values | External secret manager |
| **Ingress controller** | NGINX (kind variant) | NGINX or Traefik |
| **Resources** | Minimal (development) | Tuned for workload |
| **Max stores** | 10 | 50+ |
| **Autoscaling** | Disabled | HPA enabled (CPU-based) |

**Key point: Same Helm charts, different values files. Zero code changes.**

---

## Horizontal Scaling Plan

### HPA (Implemented)
HorizontalPodAutoscaler templates exist for both API and Dashboard:

| Component | Min | Max | Target CPU |
|-----------|-----|-----|------------|
| API | 2 | 10 | 70% |
| Dashboard | 2 | 5 | 80% |

Disabled locally (`autoscaling.enabled: false`), enabled in `values-prod.yaml`.

### What scales horizontally:
- **Dashboard**: Stateless nginx → add replicas freely
- **Backend API**: Mostly stateless (SQLite is the constraint)
  - For true horizontal scaling: replace SQLite with PostgreSQL
  - Orchestration uses Helm CLI → each replica can provision independently
- **Ingress Controller**: Can be scaled with replicas

### What doesn't scale horizontally:
- **MySQL per store**: Single replica. Production path → managed DB or MySQL operator
- **SQLite**: Single-writer. Production path → PostgreSQL
- **Provisioning throughput**: Scales with cluster capacity (CPU/memory/image pulls), not just API replicas

### Concurrency controls:
- `activeOperations` Map prevents concurrent ops on same store
- Rate limiter prevents provisioning spam
- Max stores quota prevents cluster exhaustion

---

## Abuse Prevention

| Control | Implementation |
|---------|---------------|
| **Rate limiting** | 30 req/min general, 5 req/min for store creation |
| **Max stores** | Configurable quota (default: 10) |
| **Provisioning timeout** | 10-minute deadline per store |
| **Audit log** | All create/delete/status changes logged with timestamps |
| **ResourceQuota** | Per-namespace CPU/memory/pod limits |
| **Blast radius** | Namespace isolation prevents cross-store impact |

---

## Upgrade & Rollback Story

### Upgrading a store:
```bash
# Update WordPress image version in values
helm upgrade store-abc ./helm/woocommerce-chart \
  --namespace store-abc \
  --set wordpress.image=wordpress:6.5-apache \
  --reuse-values
```

### Rolling back:
```bash
# See history
helm history store-abc -n store-abc

# Rollback to previous version
helm rollback store-abc 1 -n store-abc
```

### Platform upgrades:
```bash
# Rebuild images with new code
docker build -t store-api:v2 -f docker/Dockerfile.api .
kind load docker-image store-api:v2 --name store-platform

# Upgrade platform
helm upgrade platform ./helm/platform-chart \
  --namespace platform \
  --set api.image=store-api:v2
```

---

## Design Patterns Used

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Facade** | `provisioner.js` | Single entry point for lifecycle ops; routes never call Helm/kubectl directly |
| **Strategy** | `storeEngines/` | Pluggable engines (WooCommerce, Medusa) with identical interface |
| **State Machine** | Lifecycle guards in `routes/stores.js` | Prevents invalid transitions (retry-on-ready, delete-on-deleted) |
| **Reconciliation** | `recoverOnStartup()` | Compares desired vs actual state on boot, converges |
| **Async + Polling** | Create/Delete endpoints | Non-blocking ops with dashboard polling for status |

---

## Design Tradeoffs

| Decision | Tradeoff | Why we chose this way |
|----------|----------|----------------------|
| SQLite over PostgreSQL | Not horizontally scalable | Simpler, no extra container, sufficient for demo |
| Inline orchestration | No queue resilience | Simpler, fewer moving parts, idempotent retries compensate |
| WooCommerce over Medusa | Heavier containers | Mature ecosystem, official images, faster setup |
| nip.io domains | Depends on external DNS | No host file editing, better DX |
| Helm hooks for init | Job runs after install | Clean separation of deployment vs setup |
| NetworkPolicy deny-all | More YAML complexity | Strong security posture, interview differentiator |
| Structured API errors | Slight over-engineering for demo | Production-grade feel, clients can switch on `error.code` |
