import {
  ConflictException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { randomBytes } from 'crypto';
import { TokenService } from './token.service';
import { UserRole } from './user-role.type';

type MockApiUser = {
  id: string;
  email: string;
  name: string;
  password: string;
  role?: UserRole;
};

@Injectable()
export class UsersService {
  constructor(private readonly tokenService: TokenService) {}

  private readonly mockApiUrl =
    'https://69a9318232e2d46caf457de9.mockapi.io/api/users/users';

  async register(dto: RegisterUserDto) {
    const users = await this.getAllUsers();
    const existingUser = users.find((user) => user.email === dto.email);

    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const defaultName = dto.email.split('@')[0] || 'user';
    const createdUser = await this.createUser({
      email: dto.email,
      password: dto.password,
      name: defaultName,
      role: 'user',
    });

    return {
      message: 'User registered successfully.',
      user: this.toPublicUser(createdUser),
    };
  }

  async login(dto: LoginUserDto) {
    const users = await this.getAllUsers();
    const user = users.find((candidate) => candidate.email === dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (dto.password !== user.password) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const token = this.tokenService.sign({
      sub: user.id,
      email: user.email,
      role: this.resolveRole(user),
    });

    return {
      message: 'Login successful.',
      user: this.toPublicUser(user),
      token,
    };
  }

  async getAllUsers() {
    return this.request<MockApiUser[]>('');
  }

  async createUser(user: Omit<MockApiUser, 'id'>) {
    return this.request<MockApiUser>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
  }

  async updateUser(id: string, payload: Partial<Omit<MockApiUser, 'id'>>) {
    return this.request<MockApiUser>(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async deleteUser(id: string) {
    return this.request<MockApiUser>(`/${id}`, {
      method: 'DELETE',
    });
  }

  async generateSampleUsers(total = 10) {
    const users: MockApiUser[] = [];

    for (let i = 0; i < total; i++) {
      const suffix = randomBytes(3).toString('hex');
      const user = await this.createUser({
        name: `Sample User ${i + 1}`,
        email: `sample_${suffix}_${i + 1}@example.com`,
        password: '123456',
      });
      users.push(user);
    }

    return users;
  }

  private toPublicUser(user: MockApiUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: this.resolveRole(user),
    };
  }

  private resolveRole(user: MockApiUser): UserRole {
    return user.role === 'admin' ? 'admin' : 'user';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.mockApiUrl}${path}`, init);
    } catch {
      throw new InternalServerErrorException('Failed to reach user API.');
    }

    if (response.status === 404) {
      throw new NotFoundException('User not found.');
    }

    if (!response.ok) {
      throw new InternalServerErrorException(
        `User API request failed with status ${response.status}.`,
      );
    }

    return (await response.json()) as T;
  }
}
