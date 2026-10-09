import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as Minio from 'minio';
import { put, del } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

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
        this.logger.warn('MinIO initialization failed, using fallback storage', err);
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

  async createUploadToken(userId: string, originalName: string) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return { method: 'standard-multipart', clientToken: null, uploadUrl: null, pathname: null };
    }

    const extMatch = (originalName || '').match(/\.[a-z0-9]+$/i);
    const ext = extMatch ? extMatch[0].toLowerCase() : '.mp4';
    const rawBase = (originalName || 'video').replace(/\.[^.]+$/, '');
    const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'video';
    const pathname = `videos/${userId}-${Date.now()}-${safeBase}${ext}`;

    const validUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours validity

    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      maximumSizeInBytes: 100 * 1024 * 1024,
      allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'],
      token,
      validUntil,
    });

    return {
      method: 'direct-blob',
      clientToken,
      pathname,
      uploadUrl: `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`,
      validUntil,
    };
  }

  async deleteFile(url: string | null | undefined): Promise<void> {
    if (!url || typeof url !== 'string') return;
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token && url.includes('.blob.vercel-storage.com')) {
      try {
        await del(url, { token });
        this.logger.log(`Deleted Vercel blob: ${url}`);
      } catch (err: any) {
        this.logger.warn(`Failed to delete Vercel blob (${url}): ${err?.message}`);
      }
      return;
    }

    if (this.minioClient && url.includes(this.bucketName)) {
      try {
        const parts = url.split(this.bucketName + '/');
        if (parts[1]) {
          await this.minioClient.removeObject(this.bucketName, parts[1]);
          this.logger.log(`Deleted MinIO object: ${parts[1]}`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to delete MinIO object: ${err?.message}`);
      }
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) {
      try {
        const extMatch = (file.originalname || '').match(/\.[a-z0-9]+$/i);
        const ext = extMatch ? extMatch[0].toLowerCase() : '.mp4';
        const rawBase = (file.originalname || 'upload').replace(/\.[^.]+$/, '');
        const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'upload';
        const pathname = `videos/${Date.now()}-${safeBase}${ext}`;

        const blob = await put(pathname, file.buffer, {
          access: 'public',
          contentType: file.mimetype || 'video/mp4',
          token,
        });
        return blob.url;
      } catch (err: any) {
        this.logger.warn(`Vercel Blob put failed (${err?.message}), checking other storage`);
      }
    }

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

