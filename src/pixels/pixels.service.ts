import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pixel } from './entities/pixel.entity';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { PixelResponseDto } from './dto/pixel-response.dto';
import { DeletePixelDto } from './dto/delete-pixel.dto';
import { WebsocketGateway } from './pixels.gateway';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

interface PendingPixel {
  x: number;
  y: number;
  color: string;
  insertedBy: string;
  timestamp: number;
}

@Injectable()
export class PixelsService {
  private readonly logger = new Logger(PixelsService.name);
  private readonly redisClient: Redis;
  private readonly PIXEL_BUFFER_KEY = 'pixel_buffer';
  private readonly PIXEL_GRID_KEY = 'pixel_grid';
  private readonly BATCH_SIZE = 100;
  private readonly BUFFER_TTL = 300; // 5 minutes
  
  constructor(
    @InjectRepository(Pixel)
    private readonly pixelRepository: Repository<Pixel>,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly configService: ConfigService,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get<string>('redis.host') || 'localhost',
      port: this.configService.get<number>('redis.port') || 6379,
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      commandTimeout: 5000,
      lazyConnect: true,
    });
  }

  async onModuleInit() {
    await this.initializePixelCache();
  }

  private async initializePixelCache() {
    const exists = await this.redisClient.exists(this.PIXEL_GRID_KEY);
    if (!exists) {
      const pixels = await this.pixelRepository.find();
      const pixelMap = {};

      pixels.forEach((pixel) => {
        pixelMap[`${pixel.x},${pixel.y}`] = JSON.stringify({
          x: pixel.x,
          y: pixel.y,
          color: pixel.color,
          insertedBy: pixel.insertedBy,
          updatedAt: pixel.updatedAt,
        });
      });

      if (Object.keys(pixelMap).length > 0) {
        await this.redisClient.hset(this.PIXEL_GRID_KEY, pixelMap);
      }
      await this.redisClient.expire(this.PIXEL_GRID_KEY, 36000); // 1 hour
    }
  }

  async getAllPixels(): Promise<PixelResponseDto[]> {
    try {
      const cachedPixels = await this.redisClient.hgetall(this.PIXEL_GRID_KEY);
      if (Object.keys(cachedPixels).length > 0) {
        return Object.values(cachedPixels).map((pixel) => JSON.parse(pixel));
      }
    } catch (error) {
      this.logger.warn('Cache miss, falling back to database', error);
    }

    const pixels = await this.pixelRepository.find({
      order: { updatedAt: 'DESC' },
    });

    // update cache asynchronously
    this.updatePixelCache(pixels).catch(() => {
      this.logger.error('Failed to update pixel cache');
    });

    return pixels.map(this.toResponseDto);
  }

  async setPixel(createPixelDto: CreatePixelDto): Promise<PixelResponseDto> {
    const { x, y, color, insertedBy } = createPixelDto;

    const pendingPixel: PendingPixel = {
      x,
      y,
      color,
      insertedBy,
      timestamp: Date.now(),
    };

    const bufferKey = `${this.PIXEL_BUFFER_KEY}:${x},${y}`;
    await this.redisClient.setex(
      bufferKey,
      this.BUFFER_TTL,
      JSON.stringify(pendingPixel),
    );

    const pixelKey = `${x},${y}`;
    const responseDto: PixelResponseDto = {
      x,
      y,
      color,
      insertedBy,
      updatedAt: new Date(),
    };

    await this.redisClient.hset(
      this.PIXEL_GRID_KEY,
      pixelKey,
      JSON.stringify(responseDto),
    );

    this.websocketGateway.broadcastPixelUpdate(responseDto);

    return responseDto;
  }

  async deletePixel(
    deletePixelDto: DeletePixelDto,
  ): Promise<{ x: number; y: number }> {
    const { x, y } = deletePixelDto;

    const bufferKey = `${this.PIXEL_BUFFER_KEY}:${x},${y}`;
    await this.redisClient.del(bufferKey);

    const pixelKey = `${x},${y}`;
    await this.redisClient.hdel(this.PIXEL_GRID_KEY, pixelKey);

    const result = await this.pixelRepository
      .createQueryBuilder()
      .delete()
      .from(Pixel)
      .where('x = :x AND y = :y', { x, y })
      .returning(['x', 'y'])
      .execute();

    // Even if no pixel was found in database, we still broadcast the delete
    // to ensure all clients are in sync (in case pixel only existed in cache)
    this.websocketGateway.broadcastPixelDelete(x, y);

    // Return the coordinates regardless of whether pixel existed
    return { x, y };
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processPendingPixels() {
    try {
      const bufferPattern = `${this.PIXEL_BUFFER_KEY}:*`;
      const keys = await this.redisClient.keys(bufferPattern);
      if (keys.length === 0) {
        return;
      }

      const batches: string[][] = [];
      for (let i = 0; i < keys.length; i += this.BATCH_SIZE) {
        batches.push(keys.slice(i, i + this.BATCH_SIZE));
      }

      for (const batch of batches) {
        await this.processBatch(batch);
      }
    } catch (error) {
      this.logger.error('Error processing pending pixels', error);
    }
  }

  private async processBatch(keys: string[]) {
    const pixels: PendingPixel[] = [];

    for (const key of keys) {
      const pixelData = await this.redisClient.get(key);
      if (pixelData) {
        pixels.push(JSON.parse(pixelData));
      }
    }

    if (pixels.length === 0) return;

    const values = pixels.map((pixel) => ({
      x: pixel.x,
      y: pixel.y,
      color: pixel.color,
      insertedBy: pixel.insertedBy,
    }));

    try {
      await this.pixelRepository
        .createQueryBuilder()
        .insert()
        .into(Pixel)
        .values(values)
        .orUpdate(['color', 'inserted_by', 'updated_at'], ['x', 'y'])
        .execute();

      await this.redisClient.del(keys);
    } catch (error) {
      this.logger.error('Error inserting pixels into database', error);
    }
  }

  private async updatePixelCache(pixels: Pixel[]) {
    const pixelMap = {};

    pixels.forEach((pixel) => {
      pixelMap[`${pixel.x},${pixel.y}`] = JSON.stringify(
        this.toResponseDto(pixel),
      );
    });

    if (Object.keys(pixelMap).length > 0) {
      await this.redisClient.hset(this.PIXEL_GRID_KEY, pixelMap);
    }
    await this.redisClient.expire(this.PIXEL_GRID_KEY, 3600);
  }

  async getLeaderboard(): Promise<{ name: string; pixelCount: number }[]> {
    return this.pixelRepository
      .createQueryBuilder('pixel')
      .select('pixel.inserted_by', 'name')
      .addSelect('COUNT(*)', 'pixelCount')
      .groupBy('pixel.inserted_by')
      .orderBy('COUNT(*)', 'DESC')
      .limit(100)
      .getRawMany();
  }

  private toResponseDto(pixel: Pixel): PixelResponseDto {
    return {
      x: pixel.x,
      y: pixel.y,
      color: pixel.color,
      insertedBy: pixel.insertedBy,
      updatedAt: pixel.updatedAt,
    };
  }
}