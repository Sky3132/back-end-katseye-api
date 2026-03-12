import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtCookieGuard } from '../users/jwt-cookie.guard';
import { AdminGuard } from '../users/admin.guard';
import { UploadsService } from './uploads.service';

@Controller('admin/uploads')
@UseGuards(JwtCookieGuard, AdminGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@Req() req: Request) {
    const file = (req as Request & { file?: unknown }).file;
    if (!file) {
      throw new BadRequestException('Missing file. Send as multipart/form-data with field "file".');
    }

    return this.uploadsService.saveImage(req, file);
  }
}
