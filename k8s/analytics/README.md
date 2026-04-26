# Analytics Service Kubernetes Manifests

These manifests are pre-deploy readiness files for the analytics-service. They are not proof of a k3s rollout, and applying or smoke-testing them in a live cluster is a separate iteration.

## Image

Build the service image from the repository root with:

```bash
docker build -f analytics/Dockerfile -t risk-score-analytics:latest .
```

For local k3s, import the built image into the cluster image store before applying these manifests. For shared environments, replace `risk-score-analytics:latest` with a registry image tag.

## Runtime Configuration

`analytics-config` contains only non-secret values:

- `BTC_MODEL_PATH=models/btc_xgboost.json`
- `MAX_DEPTH=5`
- `MAX_ADDRESSES_PER_ANALYSIS=20`

`analytics-secret` contains placeholder values only. Replace `DATABASE_URL` and any blockchain API keys with real secret material before deploying, without committing real secrets.

## Model Artifacts

The current MVP flow expects `analytics/models/btc_xgboost.json` and `analytics/models/btc_scaler.json` to be baked into the image by `analytics/Dockerfile`. These manifests do not mount a model volume, ConfigMap, Secret, or initContainer.

## Probes

The startup and liveness probes use `/health`. The readiness probe uses `/api/model/status`; Kubernetes checks the HTTP status only and does not inspect whether the JSON body reports `loaded` or `heuristic_fallback`.

## External APIs

Blockchain API keys are optional for service startup. They improve real fetch quality and provider quotas at request time, but missing keys should not prevent the Pod from starting.
