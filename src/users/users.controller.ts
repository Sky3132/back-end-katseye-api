import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  Put,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser } from './auth-user.interface';
import { AdminGuard } from './admin.guard';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { AUTH_COOKIE_MAX_AGE_MS } from './auth.constants';
import { JwtCookieGuard } from './jwt-cookie.guard';
import { UsersService } from './users.service';
import { PlainTextHttpExceptionFilter } from '../common/plain-text-http-exception.filter';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  @UseFilters(PlainTextHttpExceptionFilter)
  register(@Body() dto: RegisterUserDto) {
    return this.usersService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseFilters(PlainTextHttpExceptionFilter)
  async login(@Body() dto: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.usersService.login(dto);
    res.cookie('auth_token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
      path: '/',
    });

    return {
      message: result.message,
      user: result.user,
      token: result.token,
    };
  }

  @Get('me')
  @UseGuards(JwtCookieGuard)
  getCurrentUser(@Req() req: Request & { user?: AuthUser }) {
    return this.usersService.getCurrentUser(req.user as AuthUser);
  }

  @Get('mockapi')
  @UseGuards(JwtCookieGuard, AdminGuard)
  getAllUsers() {
    return this.usersService.getAllUsers();
  }

  @Post('mockapi')
  @UseGuards(JwtCookieGuard, AdminGuard)
  createUser(
    @Body() dto: { name: string; email: string; password: string },
  ) {
    return this.usersService.createUser(dto);
  }

  @Put('mockapi/:id')
  @UseGuards(JwtCookieGuard, AdminGuard)
  updateUser(
    @Param('id') id: string,
    @Body() dto: { name?: string; email?: string; password?: string },
  ) {
    return this.usersService.updateUser(id, dto);
  }

  @Delete('mockapi/:id')
  @UseGuards(JwtCookieGuard, AdminGuard)
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }

  @Post('mockapi/generate/:count')
  @UseGuards(JwtCookieGuard, AdminGuard)
  generateSampleUsers(@Param('count', ParseIntPipe) count: number) {
    return this.usersService.generateSampleUsers(count);
  }
}
