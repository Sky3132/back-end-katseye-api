import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

type UploadedFile = {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
};

@Injectable()
export class UploadsService {
  saveImage(req: Request, file: unknown) {
    const uploaded = file as UploadedFile;

    if (!uploaded.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image uploads are allowed.');
    }

    if (typeof uploaded.size === 'number' && uploaded.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image is too large (max 10MB).');
    }

    if (
      !uploaded.buffer ||
      !Buffer.isBuffer(uploaded.buffer) ||
      uploaded.buffer.length === 0
    ) {
      throw new BadRequestException(
        'Upload misconfigured: expected file buffer. Ensure the client sends multipart/form-data.',
      );
    }

    const uploadsDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }

    const originalExt = extname(uploaded.originalname || '').toLowerCase();
    const ext = this.toSafeImageExtension(originalExt, uploaded.mimetype ?? '');
    const filename = `${randomUUID()}${ext}`;
    const filepath = join(uploadsDir, filename);

    writeFileSync(filepath, uploaded.buffer);

    const publicBase = (process.env.API_PUBLIC_URL ?? '').trim();
    const urlBase = publicBase.length ? publicBase : this.requestBaseUrl(req);
    const url = `${urlBase}/uploads/${filename}`;

    return {
      filename,
      url,
      mimetype: uploaded.mimetype ?? null,
      size: uploaded.size ?? null,
    };
  }

  private requestBaseUrl(req: Request) {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const host = req.get('host');
    return `${proto}://${host}`;
  }

  private toSafeImageExtension(originalExt: string, mimetype: string) {
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
    if (allowed.has(originalExt)) return originalExt;
    if (mimetype === 'image/png') return '.png';
    if (mimetype === 'image/webp') return '.webp';
    if (mimetype === 'image/gif') return '.gif';
    return '.jpg';
  }
}
