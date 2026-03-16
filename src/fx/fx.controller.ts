import { Controller, Get, Query } from '@nestjs/common';
import { FxService } from './fx.service';

@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get()
  getFx(
    @Query('base') base: string,
    @Query('quote') quote: string,
  ): {
    base: 'USD';
    quote: 'USD' | 'PHP' | 'JPY' | 'KRW';
    rate: number;
    asOf: string;
    source: 'env';
  } {
    const normalizedBase = (base ?? '').trim().toUpperCase();
    const normalizedQuote = (quote ?? '').trim().toUpperCase();

    return this.fx.getRate(normalizedBase, normalizedQuote);
  }
}
