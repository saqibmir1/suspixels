import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redisClient: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
    });
  }

  async testFunction() {
    const response = await this.redisClient.ping();
    this.logger.log(`Redis ping response: ${response}`);
    return { message: 'Redis connection is working', response };
  }

  async getMetrics() {
    const bufferKeys = await this.redisClient.keys('pixel_buffer:*');
    const cacheSize = await this.redisClient.hlen('pixel_grid');
    const lastProcessed = new Date().getTime().toString();
    return {
      pendingPixels: bufferKeys.length,
      cachedPixels: cacheSize,
      lastProcessed: lastProcessed,
    };
  }
}
