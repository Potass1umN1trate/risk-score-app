# Feed Collector — Kubernetes CronJob

Runs `feed_collector` as a daily CronJob in the `risk-score-app` namespace. The default source is **OFAC** (no API key required).

---

## Build

Build from the **repository root** (not from `feed_collector/`):

```bash
docker build -t risk-score-feed-collector:latest -f feed_collector/Dockerfile .
```

Import into local k3s:

```bash
docker save risk-score-feed-collector:latest | sudo k3s ctr images import -
```

---

## Secret Setup

Copy the example and fill in the real database password. **Never commit `secret.yaml`.**

```bash
cp k8s/feed-collector/secret.yaml.example k8s/feed-collector/secret.yaml
```

Edit `k8s/feed-collector/secret.yaml` — replace `CHANGE_ME` with the actual PostgreSQL password:

```yaml
DATABASE_URL: "postgresql://riskapp:<real-password>@postgres:5432/riskscoredb"
```

`secret.yaml` is listed in `.gitignore` (`*.yaml` is not ignored by default — add it locally or ensure it is never staged). The example file `secret.yaml.example` contains only placeholders and is safe to track.

---

## Apply Manifests

```bash
kubectl apply -f k8s/feed-collector/configmap.yaml
kubectl apply -f k8s/feed-collector/secret.yaml
kubectl apply -f k8s/feed-collector/cronjob.yaml
```

---

## Manual Trigger

Trigger a one-off job from the CronJob without waiting for the schedule:

```bash
kubectl create job --from=cronjob/feed-collector feed-collector-manual-$(date +%s) -n risk-score-app
```

---

## Logs

List recent jobs:

```bash
kubectl get jobs -n risk-score-app
```

View logs for a specific job:

```bash
kubectl logs job/<job-name> -n risk-score-app
```

A successful run prints one summary line:

```
source=ofac fetched=<n> normalized=<n> skipped=<n> persisted=<n> evidence_inserted=<n> duplicates=<n> record_errors=<n> source_errors=0 dry_run=False
```

---

## Default Source: OFAC

`ENABLED_SOURCES=ofac` in `feed-collector-config`. OFAC is the Sanctions List Service; it requires no API key, maps directly to the internal `sanctions` risk category, and is updated periodically by the US Treasury. The live `SDN_ADVANCED.XML` download was approximately 124 MB during smoke testing and grows over time. Python's DOM-style `ElementTree.fromstring()` parse expands the in-memory representation well beyond the raw file size, so the CronJob memory limit is intentionally set to **2Gi**. Do not reduce it without testing against the current live file size.

---

## Changing the Source

Edit `k8s/feed-collector/configmap.yaml` and update `ENABLED_SOURCES`:

| Value | Notes |
|---|---|
| `ofac` | Default. No API key. Sanctions list. |
| `scamsniffer` | No API key. EVM phishing blacklist. |
| `chainabuse` | Requires `CHAINABUSE_API_KEY` in `secret.yaml`. |

For Chainabuse, add the key to `secret.yaml`:

```yaml
CHAINABUSE_API_KEY: "<your-key>"
```

Then re-apply the secret and ConfigMap:

```bash
kubectl apply -f k8s/feed-collector/configmap.yaml
kubectl apply -f k8s/feed-collector/secret.yaml
```

The running CronJob picks up ConfigMap/Secret changes on the next job invocation.

---

## Schedule

`0 2 * * *` — daily at 02:00 UTC. Adjust in `cronjob.yaml` `spec.schedule` if needed.

---

## Safety Settings

| Setting | Value |
|---|---|
| `concurrencyPolicy` | `Forbid` — never run two jobs simultaneously |
| `backoffLimit` | `2` — up to 2 retries per schedule tick |
| `activeDeadlineSeconds` | `1800` — hard 30-minute kill |
| `restartPolicy` | `OnFailure` |
| `successfulJobsHistoryLimit` | `3` |
| `failedJobsHistoryLimit` | `3` |
