# AWS Deployment Guide

This backend is designed to deploy on AWS without code changes — only configuration. The database layer targets Amazon RDS PostgreSQL, and the storage integration is S3-API compatible (Wasabi).

## Target architecture

```text
            React Native App
                   │  HTTPS
                   ▼
           AWS API Gateway (HTTP API)
                   │
                   ▼
      ECS Fargate service (Node.js API)     ← or Lambda + adapter
         │                     │
         ▼                     ▼
 Amazon RDS PostgreSQL     Wasabi Object Storage
 (private subnets)         (application files)
         │
   Secrets Manager, CloudWatch, IAM
```

## 1. Networking (VPC)

- Create a VPC with 2+ AZs: public subnets (ALB/NAT) and **private subnets** (RDS + ECS tasks).
- RDS must live in private subnets with **no public accessibility**.
- Security groups:
  - `sg-api`: inbound 4000 from the ALB only; outbound 443 (Wasabi, AWS APIs) and 5432 to `sg-db`.
  - `sg-db`: inbound 5432 **only** from `sg-api`.

## 2. Amazon RDS PostgreSQL

- Engine: PostgreSQL 16, Multi-AZ for production.
- Storage encryption at rest (KMS) — enabled by default.
- Enforce TLS: parameter group `rds.force_ssl = 1`.
- Automated backups (7–35 days) + deletion protection.
- Create the app database and user; store credentials in Secrets Manager (see below).

Migrations run automatically on deploy (see §5) — never modify the production schema by hand.

## 3. Secrets Manager

Create one secret per environment (`servicefinance/production`), containing:

```json
{
  "DATABASE_URL": "postgres://app:...@<rds-endpoint>:5432/servicefinance?sslmode=require",
  "JWT_SECRET": "...",
  "JWT_REFRESH_SECRET": "...",
  "STORAGE_ENDPOINT": "https://s3.us-central-1.wasabisys.com",
  "STORAGE_REGION": "us-central-1",
  "STORAGE_BUCKET": "servicefinance-files-prod",
  "STORAGE_ACCESS_KEY": "...",
  "STORAGE_SECRET_KEY": "...",
  "PAYMENT_SECRET_KEY": "..."
}
```

Grant the ECS task role `secretsmanager:GetSecretValue` on that ARN only. Inject values as container secrets in the task definition — never bake them into images or the mobile bundle.

## 4. Backend hosting — ECS Fargate (recommended)

1. Containerize: `docker build` from `backend/` (multi-stage: `npm ci && npm run build`, then run `node dist/server.js`).
2. Push to ECR.
3. ECS service (2+ tasks across AZs) in private subnets behind an ALB.
4. Health check: `GET /health`.
5. Task role: Secrets Manager read + CloudWatch Logs write. **No S3/Wasabi keys in IAM** — Wasabi uses its own keys from Secrets Manager.

Lambda alternative: wrap the Express app with `@vendia/serverless-express` behind API Gateway; use RDS Proxy to manage connection pooling.

## 5. Migrations on deploy

Run `npm run migrate` as a one-off ECS task (same image, override command) before flipping the service to the new task definition — e.g., a CodePipeline/GitHub Actions step. Migrations are idempotent and tracked in the `schema_migrations` table.

## 6. API Gateway + TLS

- HTTP API (or ALB directly) with a custom domain + ACM certificate.
- Enable throttling (the app also rate-limits per-IP internally).
- Point the mobile app at the public URL via `EXPO_PUBLIC_API_URL`.

## 7. Observability

- Container logs (pino JSON) → CloudWatch Logs.
- Alarms: ALB 5xx rate, target response time, RDS CPU/storage/connections.
- Enable RDS Performance Insights.

## 8. Background jobs

The API process runs an in-process hourly scheduler (recurring appointment generation, AutoPay, reminders, past-due marking). With multiple ECS tasks, either:
- run a dedicated single-task "worker" service with `JOBS_ENABLED=true` and disable jobs on web tasks, or
- move jobs to EventBridge Scheduler → ECS RunTask/Lambda invocations.

## 9. Environments

Use separate AWS accounts or at minimum separate VPCs/secrets per environment:

```text
development  → local docker compose (this repo's default)
staging      → small RDS instance, staging Wasabi bucket
production   → Multi-AZ RDS, production Wasabi bucket
```

All environment differences are environment variables only — see `backend/.env.example`.

## Security checklist

- [x] RDS in private subnets, not publicly accessible
- [x] TLS everywhere (ACM at the edge, `sslmode=require` to RDS)
- [x] Secrets only in Secrets Manager / task secrets
- [x] IAM roles scoped to least privilege
- [x] No credentials of any kind in the mobile bundle (verified via bundle scan)
- [x] Storage access via short-lived presigned URLs only
