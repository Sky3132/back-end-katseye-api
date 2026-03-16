import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

type FxQuote = 'USD' | 'PHP' | 'JPY' | 'KRW';

@Injectable()
export class FxService {
  private cachedRaw: string | null = null;
  private cachedRates: Record<string, number> | null = null;

  getRate(
    base: string,
    quote: string,
  ): {
    base: 'USD';
    quote: FxQuote;
    rate: number;
    asOf: string;
    source: 'env';
  } {
    if (base !== 'USD') {
      throw new BadRequestException('Only base=USD is supported.');
    }

    if (quote !== 'USD' && quote !== 'PHP' && quote !== 'JPY' && quote !== 'KRW') {
      throw new BadRequestException('Only quote=USD|PHP|JPY|KRW is supported.');
    }

    if (quote === 'USD') {
      return {
        base: 'USD',
        quote: 'USD',
        rate: 1,
        asOf: new Date().toISOString(),
        source: 'env',
      };
    }

    const rates = this.getRatesFromEnv();
    const rate = rates[quote];
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new NotFoundException(
        `FX rate not configured for quote=${quote}.`,
      );
    }

    return {
      base: 'USD',
      quote,
      rate,
      asOf: new Date().toISOString(),
      source: 'env',
    };
  }

  getRatesFromEnv(): Record<string, number> {
    const raw = (process.env.FX_RATES_USD_JSON ?? '').trim();
    if (!raw) {
      throw new BadRequestException(
        'FX_RATES_USD_JSON is not set. Configure it in the backend .env.',
      );
    }

    if (this.cachedRaw === raw && this.cachedRates) return this.cachedRates;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('FX_RATES_USD_JSON must be valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('FX_RATES_USD_JSON must be a JSON object.');
    }

    const obj = parsed as Record<string, unknown>;
    const rates: Record<string, number> = {};
    for (const [key, value] of Object.entries(obj)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) rates[key.trim().toUpperCase()] = n;
    }

    this.cachedRaw = raw;
    this.cachedRates = rates;
    return rates;
  }
}
