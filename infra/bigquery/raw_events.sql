-- Every raw event the archive worker keeps (backend/src/archiveWorker.ts), one row per event as in
-- backend/src/services/archiveRow.ts. At least once: read through a view that keeps one row per eventId.
CREATE TABLE IF NOT EXISTS `neon_snake.raw_events` (
  eventId STRING NOT NULL,
  schemaVersion INT64 NOT NULL,
  type STRING NOT NULL,
  sessionId STRING NOT NULL,
  runId STRING NOT NULL,
  level INT64 NOT NULL,
  occurredAt TIMESTAMP NOT NULL,
  receivedAt TIMESTAMP NOT NULL,
  outcome STRING,
  failureReason STRING,
  score INT64,
  levelScore INT64,
  progress INT64,
  durationMs INT64
)
PARTITION BY DATE(occurredAt)
CLUSTER BY type, level
OPTIONS (partition_expiration_days = 90, require_partition_filter = TRUE);

-- One row per event, the first that arrived.
CREATE OR REPLACE VIEW `neon_snake.events_clean` AS
SELECT * EXCEPT (rank)
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY eventId ORDER BY receivedAt) AS rank
  FROM `neon_snake.raw_events`
)
WHERE rank = 1;
