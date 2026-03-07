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
  Res,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { JwtCookieGuard } from './jwt-cookie.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.usersService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.usersService.login(dto);
    res.cookie('auth_token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 1000,
    });

    return {
      message: result.message,
      user: result.user,
    };
  }

  @Get('mockapi')
  @UseGuards(JwtCookieGuard)
  getAllUsers() {
    return this.usersService.getAllUsers();
  }

  @Post('mockapi')
  @UseGuards(JwtCookieGuard)
  createUser(
    @Body() dto: { name: string; email: string; password: string },
  ) {
    return this.usersService.createUser(dto);
  }

  @Put('mockapi/:id')
  @UseGuards(JwtCookieGuard)
  updateUser(
    @Param('id') id: string,
    @Body() dto: { name?: string; email?: string; password?: string },
  ) {
    return this.usersService.updateUser(id, dto);
  }

  @Delete('mockapi/:id')
  @UseGuards(JwtCookieGuard)
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }

  @Post('mockapi/generate/:count')
  @UseGuards(JwtCookieGuard)
  generateSampleUsers(@Param('count', ParseIntPipe) count: number) {
    return this.usersService.generateSampleUsers(count);
  }
}
