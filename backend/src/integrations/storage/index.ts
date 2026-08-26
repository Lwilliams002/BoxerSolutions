import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config';

/**
 * Object storage provider abstraction. Wasabi exposes an S3-compatible API,
 * so the same client works for Wasabi (production), MinIO (local dev), or S3.
 * Only the endpoint/credentials change per environment.
 */
export interface StorageProvider {
  getUploadUrl(objectKey: string, mimeType: string, ttlSeconds?: number): Promise<string>;
  getDownloadUrl(objectKey: string, ttlSeconds?: number): Promise<string>;
  putObject(objectKey: string, body: Buffer, mimeType: string): Promise<void>;
  getObject(objectKey: string): Promise<Buffer>;
  objectExists(objectKey: string): Promise<boolean>;
  deleteObject(objectKey: string): Promise<void>;
  bucket: string;
}

class S3CompatibleStorage implements StorageProvider {
  private client: S3Client;
  public bucket: string;

  constructor() {
    this.bucket = config.storage.bucket;
    this.client = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      forcePathStyle: config.storage.forcePathStyle,
      credentials: {
        accessKeyId: config.storage.accessKey,
        secretAccessKey: config.storage.secretKey,
      },
    });
  }

  async getUploadUrl(objectKey: string, mimeType: string, ttlSeconds = config.storage.urlTtlSeconds) {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: mimeType });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  async getDownloadUrl(objectKey: string, ttlSeconds = config.storage.urlTtlSeconds) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  async putObject(objectKey: string, body: Buffer, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: body, ContentType: mimeType }),
    );
  }

  async getObject(objectKey: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!result.Body) return Buffer.alloc(0);
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async objectExists(objectKey: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(objectKey: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}

export const storage: StorageProvider = new S3CompatibleStorage();
