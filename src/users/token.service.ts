import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthUser } from './auth-user.interface';
import { AUTH_TOKEN_EXPIRES_IN_SECONDS } from './auth.constants';
import { UserRole } from './user-role.type';

type TokenPayload = AuthUser;

@Injectable()
export class TokenService {
  private readonly secret =
    process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

  sign(
    data: { sub: string; email: string; name?: string; role: UserRole },
    expiresInSeconds = AUTH_TOKEN_EXPIRES_IN_SECONDS,
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      sub: data.sub,
      email: data.email,
      name: data.name,
      role: data.role,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const header = this.base64UrlEncode(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    );
    const body = this.base64UrlEncode(JSON.stringify(payload));
    const signature = this.signPart(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  verify(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, body, signature] = parts;
    if (!header || !body || !signature) {
      return null;
    }

    const expectedSignature = this.signPart(`${header}.${body}`);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    try {
      const payload = JSON.parse(this.base64UrlDecode(body)) as TokenPayload;
      if (payload.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private signPart(input: string): string {
    const signature = createHmac('sha256', this.secret).update(input).digest();
    return this.toBase64Url(signature);
  }

  private base64UrlEncode(value: string): string {
    return this.toBase64Url(Buffer.from(value));
  }

  private base64UrlDecode(value: string): string {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  private toBase64Url(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
}
