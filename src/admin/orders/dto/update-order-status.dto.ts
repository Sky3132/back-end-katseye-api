import { IsIn } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsIn(['pending', 'paid', 'shipped', 'delivered'])
  status!: 'pending' | 'paid' | 'shipped' | 'delivered';
}

