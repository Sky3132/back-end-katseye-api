import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './auth-user.interface';
import { TokenService } from './token.service';

@Injectable()
export class JwtCookieGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is required.');
    }

    const payload = this.tokenService.verify(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired authentication token.');
    }

    (request as Request & { user?: AuthUser }).user = payload;
    return true;
  }

  private extractToken(request: Request): string | null {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';');
      for (const part of cookies) {
        const [key, ...rest] = part.trim().split('=');
        if (key === 'auth_token') {
          return decodeURIComponent(rest.join('='));
        }
      }
    }

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length).trim();
    }

    return null;
  }
}
