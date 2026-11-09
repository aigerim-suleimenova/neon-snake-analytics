variable "project_id" {
  description = "Google Cloud project to deploy into."
  type        = string
}

variable "region" {
  description = "Region of the Cloud Run services and the BigQuery dataset."
  type        = string
  default     = "europe-west1"
}

variable "domain" {
  description = "Domain the API is served on, e.g. api.example.com; its DNS A record must point at the load balancer's address (output api_ip)."
  type        = string
}

variable "image" {
  description = "Backend container image, e.g. europe-west1-docker.pkg.dev/<project>/neon-snake/backend:<tag>."
  type        = string
}

variable "kafka_brokers" {
  description = "Comma-separated Kafka brokers the API, the worker and the archiver reach over the VPC connector. The backend's Kafka client has no SASL support yet, so Google Managed Kafka cannot be used as is."
  type        = string
}

variable "vpc_connector" {
  description = "Serverless VPC Access connector through which the services reach Kafka, e.g. projects/<p>/locations/<r>/connectors/<name>."
  type        = string
}

variable "allowed_origins" {
  description = "Origins of the game and the dashboard, as the backend's ALLOWED_ORIGINS."
  type        = list(string)
}

variable "api_max_instances" {
  description = "Most API instances. Also given to the API as API_INSTANCES, so its in-process limits (the backstop behind Cloud Armor) split across them."
  type        = number
  default     = 10
}

variable "events_per_ip_per_minute" {
  description = "Cloud Armor limit on POST /api/events per client IP. The backend allows 60 per minute after a burst; a player sends about 2."
  type        = number
  default     = 120
}

variable "reads_per_ip_per_minute" {
  description = "Cloud Armor limit on the statistics and health routes per client IP."
  type        = number
  default     = 120
}
