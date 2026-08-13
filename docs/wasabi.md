# Wasabi Object Storage

Wasabi is the primary application file store (photos, invoice PDFs, signatures, documents). The backend talks to it through the standard S3 API, so **local development uses MinIO with identical code** — switching to Wasabi is configuration only.

## How file access works

The mobile app never receives storage credentials. All access is brokered by the API with short-lived presigned URLs (300s TTL):

```text
Upload:    app → POST /api/v1/files/upload-request → presigned PUT URL
           app → PUT file bytes to storage
           app → POST /api/v1/files/{id}/confirm    (server verifies object exists)

Download:  app → GET /api/v1/files/{id}/download    (authorization checked)
           ← presigned GET URL
```

The database stores only metadata (`files` table): file type, name, mime type, size, bucket, object key, uploader, timestamps.

## Object key conventions

```text
customers/{customerId}/photos/{fileId}.jpg
appointments/{appointmentId}/photos/{fileId}.jpg
invoices/{invoiceId}/{invoiceNumber}.pdf
signatures/{appointmentId}/{fileId}.png
documents/{customerId}/{fileId}.{ext}
```

No customer names appear in object keys.

## Switching from MinIO (dev) to Wasabi (prod)

1. Create a Wasabi bucket (e.g. `servicefinance-files-prod`) in your region.
2. Create a Wasabi sub-user + access key restricted to that bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::servicefinance-files-prod",
      "arn:aws:s3:::servicefinance-files-prod/*"
    ]
  }]
}
```

3. Change environment variables — nothing else:

```bash
STORAGE_ENDPOINT=https://s3.us-central-1.wasabisys.com   # your Wasabi region endpoint
STORAGE_REGION=us-central-1
STORAGE_BUCKET=servicefinance-files-prod
STORAGE_ACCESS_KEY=<wasabi access key>
STORAGE_SECRET_KEY=<wasabi secret key>
STORAGE_FORCE_PATH_STYLE=false
```

4. Keep the bucket **private** (no public access). Presigned URLs handle all client access.

## Notes

- Wasabi has no egress fees but a 90-day minimum storage duration — deletion of recent objects still bills the remainder; this is fine for service records which are retained anyway.
- Keep AWS S3 out of the application file path; S3 is only used if some AWS-specific infrastructure requires it (none does today).
- Enable bucket versioning for accidental-deletion protection if desired.
