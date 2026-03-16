import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { UsersModule } from '../users/users.module';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';

@Module({
  imports: [UsersModule, LocationsModule],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
