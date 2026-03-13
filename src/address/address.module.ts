import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';

@Module({
  imports: [UsersModule],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
