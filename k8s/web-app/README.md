# Web-App Kubernetes Deployment

These manifests prepare the Next.js web-app for local k3s/dev or staging deployment in namespace `risk-score-app`. They intentionally do not create an Ingress; use port-forwarding for the current dev flow.

## Image

Build from the repository root:

```bash
docker build -f web-app/Dockerfile -t risk-score-web-app:latest .
```

For local k3s, the image must be available inside the k3s/containerd image store. One common flow is:

```bash
docker save risk-score-web-app:latest -o /tmp/risk-score-web-app.tar
sudo k3s ctr images import /tmp/risk-score-web-app.tar
```

The exact import command can vary by local runtime. For shared clusters, push a registry tag and update `k8s/web-app/deployment.yaml`.

## Secrets

`k8s/web-app/secret.yaml` contains placeholder values only. Replace them before deploying to any shared environment:

- `DATABASE_URL`
- `AUTH_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

`AUTH_SECRET` must be stable across pod restarts. Generate a dev value with:

```bash
openssl rand -hex 32
```

## Apply Order

```bash
kubectl apply -f k8s/namespace.yaml

kubectl apply -f k8s/postgres/secret.yaml
kubectl apply -f k8s/postgres/initdb-configmap.yaml
kubectl apply -f k8s/postgres/pvc.yaml
kubectl apply -f k8s/postgres/deployment.yaml
kubectl apply -f k8s/postgres/service.yaml

kubectl apply -f k8s/analytics/
kubectl apply -f k8s/web-app/
```

For a fresh dev database, the initdb ConfigMap initializes the schema only when the PVC is empty. Existing PVCs need migrations.

## Existing PVC Migrations

Copy and apply the SQL migrations to an already-running Postgres pod:

```bash
POSTGRES_POD=$(kubectl -n risk-score-app get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')

kubectl -n risk-score-app cp k8s/postgres/migrations/20260429_network_analysis_limits.sql "$POSTGRES_POD":/tmp/20260429_network_analysis_limits.sql
kubectl -n risk-score-app cp k8s/postgres/migrations/20260501_audit_logs_actor_role.sql "$POSTGRES_POD":/tmp/20260501_audit_logs_actor_role.sql

kubectl -n risk-score-app exec "$POSTGRES_POD" -- psql -U riskapp -d riskscoredb -f /tmp/20260429_network_analysis_limits.sql
kubectl -n risk-score-app exec "$POSTGRES_POD" -- psql -U riskapp -d riskscoredb -f /tmp/20260501_audit_logs_actor_role.sql
```

## Seed Admin

After the web-app deployment is running:

```bash
kubectl -n risk-score-app exec deploy/web-app -- npm run seed:admin
```

This uses `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` from `web-app-secret`.

## Dev Access

Port-forward the internal ClusterIP service:

```bash
kubectl -n risk-score-app port-forward service/web-app 3200:3000
```

Open:

```text
http://localhost:3200
```

For GitHub OAuth in this dev flow, configure the GitHub OAuth callback URL as:

```text
http://localhost:3200/api/auth/callback/github
```

If you use a different external URL, update both `NEXTAUTH_URL` in `k8s/web-app/configmap.yaml` and the GitHub OAuth callback.

## Smoke Checks

```bash
kubectl -n risk-score-app get pods,svc,pvc
kubectl -n risk-score-app logs deployment/web-app --tail=100
kubectl -n risk-score-app logs deployment/postgres --tail=100
kubectl -n risk-score-app logs deployment/analytics-service --tail=100

curl -i http://localhost:3200/api/auth/session
kubectl -n risk-score-app run tmp-curl --rm -it --image=curlimages/curl -- \
  curl -sS http://analytics-service:8000/health

kubectl -n risk-score-app exec deploy/postgres -- psql -U riskapp -d riskscoredb -c "\d networks"
kubectl -n risk-score-app exec deploy/postgres -- psql -U riskapp -d riskscoredb -c "\d audit_logs"
kubectl -n risk-score-app exec deploy/postgres -- psql -U riskapp -d riskscoredb -c "SELECT default_depth, max_depth, default_tx_limit, max_tx_limit, default_period_days, max_period_days FROM networks LIMIT 1;"
kubectl -n risk-score-app exec deploy/postgres -- psql -U riskapp -d riskscoredb -c "SELECT actor_role FROM audit_logs LIMIT 1;"
```

Manual smoke path:

1. Log in as the seeded admin.
2. Run an analysis.
3. Open `/history`.
4. Create, deactivate, and reactivate a flagged address.
5. Open `/admin/audit-logs`.
