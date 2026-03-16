import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  hashPassword,
  isHashedPassword,
  verifyPassword,
} from '../common/password';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
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

      const existingUserWithAdminEmail = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingUserWithAdminEmail) {
        throw new ConflictException('Email is already registered.');
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

    const existingAdminWithUserEmail = await this.prisma.admin.findUnique({
      where: { username: email },
    });
    if (existingAdminWithUserEmail) {
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

    const [admin, user] = await Promise.all([
      this.prisma.admin.findUnique({ where: { username: identifier } }),
      this.prisma.user.findUnique({ where: { email: identifier } }),
    ]);

    const canAttemptAdmin = !!admin;

    if (canAttemptAdmin) {
      const adminOk = await verifyPassword(dto.password, admin.password);
      if (adminOk) {
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
    }

    if (user) {
      const userOk = await verifyPassword(dto.password, user.password);
      if (!userOk) {
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

    throw new UnauthorizedException('Email or password is incorrect.');
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

  async getMe(authUser: { sub: string; email: string; name?: string; role: UserRole }) {
    if (authUser.role === 'admin') {
      return this.getCurrentUser(authUser);
    }

    const userId = this.parseUserId(authUser.sub);
    let user: { user_id: number; email: string; name: string; role: UserRole; details?: { full_name: string | null; phone_e164: string | null } | null } | null =
      null;
    try {
      user = await this.prisma.user.findUnique({
        where: { user_id: userId },
        include: { details: true },
      });
    } catch (err) {
      if (this.isMissingUserDetailsTable(err)) {
        user = await this.prisma.user.findUnique({
          where: { user_id: userId },
        });
      } else {
        throw err;
      }
    }

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: String(user.user_id),
      email: user.email,
      name: user.name,
      role: user.role,
      full_name: user.details?.full_name ?? null,
      phone_e164: user.details?.phone_e164 ?? null,
    };
  }

  async updateMe(
    authUser: { sub: string; email: string; name?: string; role: UserRole },
    dto: UpdateMeDto,
  ) {
    if (authUser.role === 'admin') {
      throw new BadRequestException('Admin profile cannot be edited here.');
    }

    const userId = this.parseUserId(authUser.sub);

    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingUser && existingUser.user_id !== userId) {
        throw new ConflictException('Email is already registered.');
      }
    }

    await this.findUserById(userId);

    try {
      await this.prisma.user.update({
        where: { user_id: userId },
        data: {
          name: dto.name,
          email: dto.email?.trim().toLowerCase(),
          details: {
            upsert: {
              create: {
                full_name: dto.full_name,
                phone_e164: dto.phone_e164,
              },
              update: {
                full_name: dto.full_name,
                phone_e164: dto.phone_e164,
              },
            },
          },
        },
      });
    } catch (err) {
      if (!this.isMissingUserDetailsTable(err)) {
        throw err;
      }
      // Allow saving basic profile even if user_details table isn't migrated yet.
      await this.prisma.user.update({
        where: { user_id: userId },
        data: {
          name: dto.name,
          email: dto.email?.trim().toLowerCase(),
        },
      });
    }

    return this.getMe({ ...authUser, sub: String(userId) });
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

  private isMissingUserDetailsTable(err: unknown) {
    const e = err as { code?: string; meta?: unknown; message?: string };
    // Prisma uses P2021 for missing table and P2022 for missing column.
    if (e?.code === 'P2021') return true;
    if (e?.code === 'P2022') {
      const meta = e.meta as { column?: string } | undefined;
      if (meta?.column?.includes('user_details')) return true;
      if (e.message?.toLowerCase().includes('user_details')) return true;
    }
    // MySQL/MariaDB missing table errors can surface without Prisma codes.
    const msg = (e?.message ?? '').toLowerCase();
    return msg.includes('user_details') && msg.includes("doesn't exist");
  }
}
