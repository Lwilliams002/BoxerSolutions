# AntServe — Field Service Management Platform

A production-ready field service management platform: React Native (Expo) mobile app, Node.js + TypeScript REST API, PostgreSQL (Amazon RDS-ready), and S3-compatible object storage (Wasabi in production, MinIO locally).

```text
React Native (Expo)
        │
        ▼
REST API  (Express, /api/v1)
        │
Controllers → Services → Repositories
        │
PostgreSQL (RDS)          Object Storage (Wasabi / MinIO)
```

## Repository layout

```text
backend/    Node.js + TypeScript API (Express, pg, zod, pino)
mobile/     React Native app (Expo Router, TanStack Query, Zustand)
infra/      Local infrastructure (docker-compose: Postgres + MinIO)
docs/       AWS deployment & Wasabi switchover guides
```

## Quick start (local development)

Prerequisites: Docker Desktop, Node 20+, npm.

### 1. Start infrastructure

```bash
cd infra
docker compose up -d
```

Starts PostgreSQL on `localhost:5433` and MinIO (Wasabi-compatible) on `localhost:9000` (console: `localhost:9001`, user `sfa-storage-key` / `sfa-storage-secret`).

### 2. Start the API

```bash
cd backend
cp .env.example .env      # local defaults work out of the box
npm install
npm run migrate           # apply database migrations
npm run seed              # load demo data
npm run dev               # API on http://localhost:4000
```

### 3. Run the mobile app

```bash
cd mobile
npm install
npm start                 # Expo dev server; press i for iOS simulator
```

### 4. Run the web app from the same codebase

```bash
cd mobile
npm install
npm run web               # Expo web dev server
```

The app auto-detects the API host from the Expo dev server. For a physical device on another network path, set it explicitly:

```bash
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npm start
```

## Demo logins

All passwords: `Demo1234!`

| Email | Role |
|---|---|
| owner@antserve.dev | OWNER (full access) |
| tech1@antserve.dev | TRUSTED_TECHNICIAN |
| tech2@antserve.dev … tech5@antserve.dev | TECHNICIAN |

Demo payment tokens (mock provider): `tok_visa_4242`, `tok_mastercard_5454`, `tok_amex_0005`. Any token containing `declined` (e.g. `tok_declined_0002`) produces a card that fails charges — useful for testing the failed-payment path.

## Key features

- **Technician workflow**: today's route → stop → On My Way → Arrived → Start Service → notes/photos/signature → Complete → auto-invoice → collect payment → receipt → service history.
- **Routes**: map + ordered stop list, time-window-aware route optimization (provider-abstracted), Start Navigation deep link.
- **Scheduling**: day-view schedule, conflict detection, recurring subscriptions generating future appointments.
- **Invoicing**: automatic invoice generation on completion, PDF generation stored in object storage, signed download URLs.
- **Payments**: tokenized payment methods (no card data stored), charge/receipt/failed-payment handling, AutoPay job.
- **Offline-first mobile**: local mutation queue with idempotency keys, photos kept on device until upload is confirmed, OFFLINE / SYNCING / SYNC ERROR states.
- **Security**: JWT access + rotating refresh tokens, DB-stored RBAC permissions, technician data scoping, audit logging, presigned URLs only (no storage credentials on device).

## API overview

Base URL `/api/v1`. Response envelope:

```json
{ "success": true, "data": {}, "message": null }
```

Resources: `auth`, `users`, `customers`, `locations`, `services`, `appointments`, `routes`, `invoices`, `payments`, `payment-methods`, `subscriptions`, `files`, `notes`, `notifications`, `dashboard`, `reports`.

Mutating endpoints accept an `Idempotency-Key` header; replays return the original response without duplicating records.

## Verification

`backend/scripts/e2e-milestone.sh` exercises the full end-to-end milestone (login → customer → appointment → route → technician workflow → photo upload → signature → complete → invoice PDF → declined + successful charge → receipt → service history → security checks). Run it with the API and infra up:

```bash
backend/scripts/e2e-milestone.sh
```

## Production deployment

- [AWS deployment guide](docs/aws-deployment.md) — RDS, ECS/Fargate, Secrets Manager, API Gateway, CloudWatch.
- [Wasabi switchover](docs/wasabi.md) — moving object storage from local MinIO to Wasabi (env-only change).

## North Developer payments

The backend now includes a North Developer payment-link scaffold for invoices and recurring-billing payload helpers. To enable it, set:

```bash
NORTH_MID=...
NORTH_DEVELOPER_KEY=...
NORTH_PASSWORD=...
NORTH_APPSOURCE=...
NORTH_SIGNATURE_SECRET=...
NORTH_FUNCTIONS_BASE_URL=https://proxy.payanywhere.com
NORTH_BILLING_BASE_URL=https://billing.epxuap.com
```

Without those values, the app keeps using the existing mock payment provider fallback.
