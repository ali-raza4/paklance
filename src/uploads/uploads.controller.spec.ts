import { Test, TestingModule } from '@nestjs/testing';
import { UploadsController } from './uploads.controller';
import { StorageService } from '../storage/storage.service';
import { BadRequestException } from '@nestjs/common';

describe('UploadsController & StorageService', () => {
  let controller: UploadsController;
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [StorageService],
    }).compile();

    controller = module.get<UploadsController>(UploadsController);
    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should successfully upload a JPEG image and return a valid data URL', async () => {
    const jpgBuffer = Buffer.from('fake-jpg-content');
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'avatar.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: jpgBuffer.length,
      buffer: jpgBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const result = await controller.uploadFile(mockFile);
    expect(result).toHaveProperty('url');
    expect(result.url).toBe(`data:image/jpeg;base64,${jpgBuffer.toString('base64')}`);
  });

  it('should successfully upload a PNG image and return a valid data URL', async () => {
    const pngBuffer = Buffer.from('fake-png-content');
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'photo.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: pngBuffer.length,
      buffer: pngBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const result = await controller.uploadFile(mockFile);
    expect(result).toHaveProperty('url');
    expect(result.url).toBe(`data:image/png;base64,${pngBuffer.toString('base64')}`);
  });

  it('should successfully upload a WebP image and return a valid data URL', async () => {
    const webpBuffer = Buffer.from('fake-webp-content');
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'photo.webp',
      encoding: '7bit',
      mimetype: 'image/webp',
      size: webpBuffer.length,
      buffer: webpBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const result = await controller.uploadFile(mockFile);
    expect(result).toHaveProperty('url');
    expect(result.url).toBe(`data:image/webp;base64,${webpBuffer.toString('base64')}`);
  });

  it('should reject non-image file types', async () => {
    const pdfBuffer = Buffer.from('fake-pdf');
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'document.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: pdfBuffer.length,
      buffer: pdfBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    await expect(controller.uploadFile(mockFile)).rejects.toThrow(BadRequestException);
  });

  it('should reject oversized files (>5MB)', async () => {
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024);
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'huge.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: bigBuffer.length,
      buffer: bigBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    await expect(controller.uploadFile(mockFile)).rejects.toThrow(BadRequestException);
  });
});
