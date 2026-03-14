import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  hashPassword,
  isHashedPassword,
  verifyPassword,
} from '../common/password';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { TokenService } from './token.service';
import { UserRole } from './user-role.type';

@Injectable()
export class UsersService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async register(dto: RegisterUserDto) {
    const email = (dto.email ?? dto.username)?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email is required.');
    }

    const roleInput = (dto.role ?? 'user').trim().toLowerCase();
    const requestedRole: UserRole = roleInput === 'admin' ? 'admin' : 'user';

    if (requestedRole === 'admin') {
      const registrationKey = dto.adminCode?.trim();
      const expectedKey = process.env.ADMIN_REGISTRATION_KEY;
      if (!expectedKey || !registrationKey || registrationKey !== expectedKey) {
        throw new UnauthorizedException('Admin code is incorrect.');
      }

      const existingAdminCount = await this.prisma.admin.count();
      if (existingAdminCount > 0) {
        throw new ConflictException('Admin account already exists.');
      }

      const existingAdmin = await this.prisma.admin.findUnique({
        where: { username: email },
      });
      if (existingAdmin) {
        throw new ConflictException('Email is already registered.');
      }

      const password = await hashPassword(dto.password);
      const createdAdmin = await this.prisma.admin.create({
        data: {
          username: email,
          password,
          role: 'admin',
        },
      });

      return {
        message: 'Admin registered successfully.',
        user: {
          id: String(createdAdmin.admin_id),
          email: createdAdmin.username,
          name: createdAdmin.username,
          role: 'admin' as const,
        },
      };
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const defaultName = email.split('@')[0] || 'user';
    const password = await hashPassword(dto.password);
    const createdUser = await this.prisma.user.create({
      data: {
        email,
        password,
        name: defaultName,
        role: 'user',
        carts: {
          create: {},
        },
      },
    });

    return {
      message: 'User registered successfully.',
      user: this.toPublicUser(createdUser),
    };
  }

  async login(dto: LoginUserDto) {
    const identifier = (dto.email ?? dto.username)?.trim().toLowerCase();
    if (!identifier) {
      throw new BadRequestException('Email is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: identifier },
    });

      if (user) {
        const ok = await verifyPassword(dto.password, user.password);
        if (!ok) {
          throw new UnauthorizedException('Email or password is incorrect.');
        }

      if (!isHashedPassword(user.password)) {
        await this.prisma.user.update({
          where: { user_id: user.user_id },
          data: { password: await hashPassword(dto.password) },
        });
      }

      const token = this.tokenService.sign({
        sub: String(user.user_id),
        email: user.email,
        name: user.name,
        role: user.role,
      });

      return {
        message: 'Login successful.',
        user: this.toPublicUser(user),
        token,
      };
    }

    const allowedAdminUsername =
      process.env.ADMIN_USERNAME?.trim().toLowerCase();
    if (allowedAdminUsername && identifier !== allowedAdminUsername) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const admin = await this.prisma.admin.findUnique({
      where: { username: identifier },
    });

    const ok = admin
      ? await verifyPassword(dto.password, admin.password)
      : false;
    if (!admin || !ok) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    if (!isHashedPassword(admin.password)) {
      await this.prisma.admin.update({
        where: { admin_id: admin.admin_id },
        data: { password: await hashPassword(dto.password) },
      });
    }

    const token = this.tokenService.sign({
      sub: String(admin.admin_id),
      email: admin.username,
      name: admin.username,
      role: 'admin',
    });

    return {
      message: 'Login successful.',
      user: {
        id: String(admin.admin_id),
        email: admin.username,
        name: admin.username,
        role: 'admin' as const,
      },
      token,
    };
  }

  async getAllUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { user_id: 'desc' },
    });

    return users.map((user) => this.toPublicUser(user));
  }

  getCurrentUser(authUser: {
    sub: string;
    email: string;
    name?: string;
    role: UserRole;
  }) {
    return {
      id: authUser.sub,
      email: authUser.email,
      name: authUser.name ?? authUser.email.split('@')[0] ?? 'user',
      role: authUser.role,
    };
  }

  async createUser(user: { name: string; email: string; password: string }) {
    const email = user.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const createdUser = await this.prisma.user.create({
      data: {
        name: user.name,
        email,
        password: await hashPassword(user.password),
        role: 'user',
        carts: {
          create: {},
        },
      },
    });

    return this.toPublicUser(createdUser);
  }

  async updateUser(
    id: string,
    payload: { name?: string; email?: string; password?: string },
  ) {
    const userId = this.parseUserId(id);
    await this.findUserById(userId);

    if (payload.email) {
      const email = payload.email.trim().toLowerCase();
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser && existingUser.user_id !== userId) {
        throw new ConflictException('Email is already registered.');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { user_id: userId },
      data: {
        name: payload.name,
        email: payload.email?.trim().toLowerCase(),
        password: payload.password
          ? await hashPassword(payload.password)
          : undefined,
      },
    });

    return this.toPublicUser(updatedUser);
  }

  async deleteUser(id: string) {
    const userId = this.parseUserId(id);
    await this.findUserById(userId);

    await this.prisma.user.delete({
      where: { user_id: userId },
    });

    return { message: 'User deleted successfully.' };
  }

  async generateSampleUsers(total = 10) {
    const users: Array<{
      id: string;
      email: string;
      name: string;
      role: UserRole;
    }> = [];

    for (let i = 0; i < total; i++) {
      const suffix = randomBytes(3).toString('hex');
      const user = await this.prisma.user.create({
        data: {
          name: `Sample User ${i + 1}`,
          email: `sample_${suffix}_${i + 1}@example.com`,
          password: await hashPassword('123456'),
          role: 'user',
          carts: {
            create: {},
          },
        },
      });
      users.push(this.toPublicUser(user));
    }

    return users;
  }

  private toPublicUser(user: {
    user_id: number;
    email: string;
    name: string;
    role: UserRole;
  }) {
    return {
      id: String(user.user_id),
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  private parseUserId(id: string) {
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new NotFoundException('User not found.');
    }

    return userId;
  }

  private async findUserById(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }
}
