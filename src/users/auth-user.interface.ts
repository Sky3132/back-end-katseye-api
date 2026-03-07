import { UserRole } from './user-role.type';

export interface AuthUser {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}
