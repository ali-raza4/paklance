import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as Minio from 'minio';

@Injectable()
export class StorageService implements OnModuleInit {
  private minioClient: Minio.Client | null = null;
  private readonly logger = new Logger(StorageService.name);
  private readonly bucketName = process.env.MINIO_BUCKET || 'paklance-uploads';

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT;
    if (endpoint && endpoint !== 'localhost' && endpoint !== '127.0.0.1') {
      try {
        this.minioClient = new Minio.Client({
          endPoint: endpoint,
          port: parseInt(process.env.MINIO_PORT || '9000', 10),
          useSSL: process.env.MINIO_USE_SSL === 'true',
          accessKey: process.env.MINIO_ROOT_USER || process.env.MINIO_ACCESS_KEY || '',
          secretKey: process.env.MINIO_ROOT_PASSWORD || process.env.MINIO_SECRET_KEY || '',
        });
      } catch (err) {
        this.logger.warn('MinIO initialization failed, using inline data storage fallback', err);
        this.minioClient = null;
      }
    }
  }

  async onModuleInit() {
    if (!this.minioClient) return;
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
        this.logger.log(`Created MinIO bucket: ${this.bucketName}`);
      }
    } catch (error: any) {
      if (
        error?.code === 'BucketAlreadyOwnedByYou' ||
        error?.code === 'BucketAlreadyExists'
      ) {
        this.logger.log(`MinIO bucket '${this.bucketName}' already exists.`);
      } else {
        this.logger.warn('MinIO bucket init check failed, fallback mode active:', error?.message);
      }
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    if (this.minioClient) {
      try {
        const filename = `${Date.now()}-${(file.originalname || 'upload').replace(/\s+/g, '-')}`;
        await this.minioClient.putObject(
          this.bucketName,
          filename,
          file.buffer,
          file.size,
          { 'Content-Type': file.mimetype || 'image/jpeg' },
        );
        const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
        const host = process.env.MINIO_PUBLIC_HOST || `${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT || '9000'}`;
        return `${protocol}://${host}/${this.bucketName}/${filename}`;
      } catch (err: any) {
        this.logger.warn(`MinIO putObject failed (${err?.message}), falling back to data URL storage`);
      }
    }

    // Default & Serverless (Vercel) storage: encode image as standard data URI
    const mimeType = file.mimetype || 'image/jpeg';
    const base64Data = file.buffer.toString('base64');
    return `data:${mimeType};base64,${base64Data}`;
  }
}

