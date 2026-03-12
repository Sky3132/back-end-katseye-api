import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './auth-user.interface';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const user = request.user;

    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin access is required.');
    }

    return true;
  }
}
