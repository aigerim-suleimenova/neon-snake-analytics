terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  # The backend's settings shared by the three services. See backend/src/config.ts.
  common_env = {
    GCLOUD_PROJECT = var.project_id
    KAFKA_BROKERS  = var.kafka_brokers
  }
}

# ---------------------------------------------------------------------------------------------------------
# Edge: HTTPS load balancer with Cloud Armor in front of the API. The API only accepts traffic from the load
# balancer, so the per-IP limits cannot be bypassed through the run.app URL.
# ---------------------------------------------------------------------------------------------------------

resource "google_compute_security_policy" "api" {
  name        = "neon-snake-api"
  description = "Per-client-IP rate limits in front of the analytics API; the API's own limits are the backstop."

  rule {
    priority    = 1000
    description = "POST /api/events per client IP"
    action      = "throttle"
    match {
      expr {
        expression = "request.path == '/api/events'"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.events_per_ip_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 1100
    description = "Statistics and health per client IP"
    action      = "throttle"
    match {
      expr {
        expression = "request.path.startsWith('/api/stats/') || request.path == '/api/health'"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.reads_per_ip_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 2147483647
    description = "Everything else"
    action      = "allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_region_network_endpoint_group" "api" {
  name                  = "neon-snake-api"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

resource "google_compute_backend_service" "api" {
  name                  = "neon-snake-api"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.api.id
  backend {
    group = google_compute_region_network_endpoint_group.api.id
  }
}

resource "google_compute_url_map" "api" {
  name            = "neon-snake-api"
  default_service = google_compute_backend_service.api.id
}

resource "google_compute_managed_ssl_certificate" "api" {
  name = "neon-snake-api"
  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "api" {
  name             = "neon-snake-api"
  url_map          = google_compute_url_map.api.id
  ssl_certificates = [google_compute_managed_ssl_certificate.api.id]
}

resource "google_compute_global_address" "api" {
  name = "neon-snake-api"
}

resource "google_compute_global_forwarding_rule" "api" {
  name                  = "neon-snake-api"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.api.id
  ip_address            = google_compute_global_address.api.id
  port_range            = "443"
}

# ---------------------------------------------------------------------------------------------------------
# Services. NOTE: backend/src/config.ts refuses to run against a real Firestore (it requires
# FIRESTORE_EMULATOR_HOST and a demo- project ID). Deploying needs an explicit production opt-in there first.
# ---------------------------------------------------------------------------------------------------------

resource "google_service_account" "api" {
  account_id   = "neon-snake-api"
  display_name = "Neon Snake analytics API"
}

resource "google_service_account" "worker" {
  account_id   = "neon-snake-worker"
  display_name = "Neon Snake ingestion worker"
}

resource "google_service_account" "snapshot" {
  account_id   = "neon-snake-snapshot"
  display_name = "Neon Snake statistics snapshot writer"
}

resource "google_service_account" "archiver" {
  account_id   = "neon-snake-archiver"
  display_name = "Neon Snake archive worker"
}

# The API reads the statistics (and stores events itself without Kafka); the worker stores them.
resource "google_project_iam_member" "firestore" {
  for_each = {
    api      = google_service_account.api.member
    worker   = google_service_account.worker.member
    snapshot = google_service_account.snapshot.member
  }
  project = var.project_id
  role    = "roles/datastore.user"
  member  = each.value
}

resource "google_cloud_run_v2_service" "api" {
  name     = "neon-snake-api"
  location = var.region
  # Only the load balancer reaches it, so Cloud Armor always applies.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.api.email
    # Live dashboard streams (Server-Sent Events) stay open; at Cloud Run's 5-minute default they would be cut,
    # and browsers reconnect, so the maximum keeps reconnects rare.
    timeout = "3600s"
    scaling {
      max_instance_count = var.api_max_instances
    }
    vpc_access {
      connector = var.vpc_connector
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image   = var.image
      command = ["node", "--import", "tsx", "src/server.ts"]
      dynamic "env" {
        for_each = merge(local.common_env, {
          HOST            = "0.0.0.0"
          ALLOWED_ORIGINS = join(",", var.allowed_origins)
          # Client -> load balancer -> Cloud Run's frontend -> container: the client IP is two entries from the
          # right of X-Forwarded-For. Check with one request after deploying (see infra/README.md).
          TRUST_PROXY   = "2"
          API_INSTANCES = tostring(var.api_max_instances)
        })
        content {
          name  = env.key
          value = env.value
        }
      }
      ports {
        container_port = 8080
      }
      startup_probe {
        http_get {
          path = "/api/health"
        }
      }
    }
  }
}

# The load balancer invokes the API without credentials; ingress above keeps everyone else out.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The background processes run as always-on services: at least one instance, CPU allocated outside requests.
# The Kafka consumers scale up to one instance per partition; the snapshot writer needs exactly one.
resource "google_cloud_run_v2_service" "consumer" {
  for_each = {
    worker   = { account = google_service_account.worker.email, script = "src/ingestWorker.ts", max = 3, env = tomap({}) }
    snapshot = { account = google_service_account.snapshot.email, script = "src/statsSnapshotWorker.ts", max = 1, env = tomap({}) }
    archiver = {
      account = google_service_account.archiver.email
      script  = "src/archiveWorker.ts"
      max     = 3
      env = tomap({
        ARCHIVE          = "bigquery"
        BIGQUERY_PROJECT = var.project_id
        BIGQUERY_DATASET = google_bigquery_dataset.analytics.dataset_id
        BIGQUERY_TABLE   = google_bigquery_table.raw_events.table_id
      })
    }
  }
  name     = "neon-snake-${each.key}"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = each.value.account
    scaling {
      min_instance_count = 1
      max_instance_count = each.value.max
    }
    vpc_access {
      connector = var.vpc_connector
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image   = var.image
      command = ["node", "--import", "tsx", each.value.script]
      resources {
        cpu_idle = false
      }
      dynamic "env" {
        for_each = merge(local.common_env, each.value.env)
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}

# ---------------------------------------------------------------------------------------------------------
# Firestore: no index on fields nothing queries, as backend/firestore.indexes.json (an indexed field whose
# values only grow caps its collection at about 500 writes per second).
# ---------------------------------------------------------------------------------------------------------

resource "google_firestore_field" "unindexed" {
  for_each = toset([
    "runs/startedAt", "runs/endedAt", "runs/startReceivedAt", "runs/endReceivedAt", "runs/updatedAt",
    "sessions/firstSeenAt", "statsShards/levels", "statsShards/sessions", "stats/counts", "stats/computedAt",
  ])
  collection = split("/", each.value)[0]
  field      = split("/", each.value)[1]
  index_config {}
}

# ---------------------------------------------------------------------------------------------------------
# BigQuery: the raw event archive, as infra/bigquery/raw_events.sql.
# ---------------------------------------------------------------------------------------------------------

resource "google_bigquery_dataset" "analytics" {
  dataset_id = "neon_snake"
  location   = var.region
}

resource "google_bigquery_table" "raw_events" {
  dataset_id               = google_bigquery_dataset.analytics.dataset_id
  table_id                 = "raw_events"
  schema                   = file("${path.module}/../bigquery/raw_events.schema.json")
  require_partition_filter = true
  clustering               = ["type", "level"]
  deletion_protection      = true

  time_partitioning {
    type          = "DAY"
    field         = "occurredAt"
    expiration_ms = 90 * 24 * 60 * 60 * 1000
  }
}

resource "google_bigquery_dataset_iam_member" "archiver" {
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_service_account.archiver.member
}

output "api_ip" {
  description = "Point the domain's DNS A record here."
  value       = google_compute_global_address.api.address
}
