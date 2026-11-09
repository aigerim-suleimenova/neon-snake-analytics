# Infrastructure

Google Cloud setup for running the analytics backend at scale. It is checked with `terraform validate` and
`terraform fmt`, but **has not been applied**: two things in the backend stop it from working as is (see
[Before the first deploy](#before-the-first-deploy)).

```text
game ──▶ HTTPS load balancer + Cloud Armor (per-IP limits) ──▶ Cloud Run: API (TRUST_PROXY=2, API_INSTANCES)
                                                                    │ publishes
                                                                    ▼
                                                           Kafka topic analytics-events
                                                     ┌──────────────┴──────────────┐
                              Cloud Run: ingestion worker               Cloud Run: archive worker
                              (batches → Firestore runs/sessions,       (raw events → BigQuery
                               counts per partition)                     neon_snake.raw_events)
```

| Path | What |
| --- | --- |
| `gcp/main.tf`, `gcp/variables.tf` | Load balancer, Cloud Armor policy, four Cloud Run services (API, ingestion worker, archive worker, statistics snapshot writer) and their service accounts, Firestore fields left unindexed, BigQuery dataset and table |
| `bigquery/raw_events.sql` | The archive table and an `events_clean` view with one row per `eventId` |
| `bigquery/raw_events.schema.json` | The same columns for Terraform; a backend test keeps them equal to the archive's rows |
| `../Dockerfile` | The backend image; the command picks the API, `src/ingestWorker.ts`, `src/archiveWorker.ts` or `src/statsSnapshotWorker.ts` |

## Rate limits

Cloud Armor is the real limit: it counts per client IP across every instance, and blocked requests never reach
Cloud Run. The defaults allow 120 posts and 120 reads per IP per minute (`events_per_ip_per_minute`,
`reads_per_ip_per_minute`), against about 2 posts a minute from a player. The API's own limits stay as the
backstop: `API_INSTANCES` splits them across the instances. The API's ingress only accepts the load balancer,
so the `run.app` URL cannot be used to get around Cloud Armor.

## Before the first deploy

1. **Production opt-in in the backend.** `backend/src/config.ts` refuses to start without
   `FIRESTORE_EMULATOR_HOST` and with a project ID not starting with `demo-`, so that nothing can reach a real
   Firebase project by accident. Running on Cloud Run needs a deliberate way to allow a real project; the
   services here would currently exit at start.
2. **Kafka.** `kafka_brokers` and `vpc_connector` point at a Kafka the services reach privately. Google
   Managed Service for Apache Kafka needs SASL authentication, which `backend/src/adapters/kafka.ts` does not
   configure yet. Create the topic with more partitions than the local 3 (e.g. 24): partitions bound how many
   workers can share the load.
3. **Firestore database.** The `google_firestore_field` resources assume the project's `(default)` database
   exists. They mirror `backend/firestore.indexes.json`, which `firebase deploy --only firestore:indexes` can
   apply instead.
4. **Check `TRUST_PROXY=2`.** Behind the load balancer, `X-Forwarded-For` reaches the container as
   `<client>, <load balancer>`, with Cloud Run's frontend as the connection, so the client is two hops in.
   After deploying, send one request and check the logged client IP is yours. If it is the load balancer's,
   every player shares one limit; if it is a value you sent in `X-Forwarded-For`, clients can choose their IP.

## Use

```bash
docker build -t "$REGION-docker.pkg.dev/$PROJECT/neon-snake/backend:$TAG" .   # from the repository root
docker push "$REGION-docker.pkg.dev/$PROJECT/neon-snake/backend:$TAG"
cd infra/gcp
terraform init
terraform apply -var project_id=$PROJECT -var domain=api.example.com -var image=... \
  -var kafka_brokers=10.0.0.10:9092 -var vpc_connector=projects/$PROJECT/locations/$REGION/connectors/neon \
  -var 'allowed_origins=["https://game.example.com","https://dashboard.example.com"]'
```

Then point the domain's A record at the `api_ip` output; the managed certificate becomes active once DNS resolves.
