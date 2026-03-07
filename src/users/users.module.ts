import { AdminGuard } from './admin.guard';
import { Module } from '@nestjs/common';
import { JwtCookieGuard } from './jwt-cookie.guard';
import { TokenService } from './token.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, TokenService, JwtCookieGuard, AdminGuard],
  exports: [TokenService, JwtCookieGuard, AdminGuard],
})
export class UsersModule {}
