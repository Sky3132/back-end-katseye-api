import { AdminGuard } from './admin.guard';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JwtCookieGuard } from './jwt-cookie.guard';
import { TokenService } from './token.service';
import { UserGuard } from './user.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, TokenService, JwtCookieGuard, AdminGuard, UserGuard],
  exports: [TokenService, JwtCookieGuard, AdminGuard, UserGuard],
})
export class UsersModule {}
