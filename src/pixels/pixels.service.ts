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
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
    });
  }

  async onModuleInit() {
    await this.initializePixelCache();
  }

  private async initializePixelCache() {
    const exists = await this.redisClient.exists(this.PIXEL_GRID_KEY);
    if (!exists) {
      this.logger.log('Initializing pixel grid cache');
      const pixels = await this.pixelRepository.find();
      const pixelMap = {};

      pixels.forEach((pixel) => {
        pixelMap[`${pixel.x},${pixel.y}`] = {
          x: pixel.x,
          y: pixel.y,
          color: pixel.color,
          insertedBy: pixel.insertedBy,
          updatedAt: pixel.updatedAt,
        };
      });

      await this.redisClient.hset(this.PIXEL_GRID_KEY, pixelMap);
      await this.redisClient.expire(this.PIXEL_GRID_KEY, 36000); // 1 hour
      this.logger.log(`Cached ${pixels.length} pixels`);
    }
  }

  async getAllPixels(): Promise<PixelResponseDto[]> {
    try {
      // try to get cahce first
      const cachedPixels = await this.redisClient.hgetall(this.PIXEL_GRID_KEY);
      if (Object.keys(cachedPixels).length > 0) {
        this.logger.log('Returning cached pixels');
        return Object.values(cachedPixels).map((pixel) => JSON.parse(pixel));
      }
    } catch (error) {
      this.logger.warn('Cache miss, falling back to database ');
    }

    // fallback to database
    const pixels = await this.pixelRepository.find({
      order: { updatedAt: 'DESC' },
    });

    // update cache asaynchronously
    this.updatePixelCache(pixels).catch((err) => {
      this.logger.error('Failed to update pixel cache', err);
    });

    return pixels.map(this.toResponseDto);
  }

  async setPixel(createPixelDto: CreatePixelDto): Promise<PixelResponseDto> {
    const { x, y, color, insertedBy } = createPixelDto;

    // Create pending pixel object
    const pendingPixel: PendingPixel = {
      x,
      y,
      color,
      insertedBy,
      timestamp: Date.now(),
    };

    // Store in Redis buffer
    const bufferKey = `${this.PIXEL_BUFFER_KEY}:${x},${y}`;
    await this.redisClient.setex(
      bufferKey,
      this.BUFFER_TTL,
      JSON.stringify(pendingPixel),
    );

    // Update cache immediately for reads
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

    this.logger.log(
      `Pixel buffered at (${x}, ${y}) by ${insertedBy} with color ${color}`,
    );

    // Broadcast immediately for real-time updates
    this.websocketGateway.broadcastPixelUpdate(responseDto);

    return responseDto;
  }

  async deletePixel(
    deletePixelDto: DeletePixelDto,
  ): Promise<{ x: number; y: number }> {
    const { x, y } = deletePixelDto;

    // remove from buffer if exists
    const bufferKey = `${this.PIXEL_BUFFER_KEY}:${x},${y}`;
    await this.redisClient.del(bufferKey);

    // remove from cache
    const pixelKey = `${x},${y}`;
    await this.redisClient.hdel(this.PIXEL_GRID_KEY, pixelKey);

    // delete from database
    const result = await this.pixelRepository
      .createQueryBuilder()
      .delete()
      .from(Pixel)
      .where('x = :x AND y = :y', { x, y })
      .returning(['x', 'y'])
      .execute();

    if (result.affected === 0) {
      throw new Error('Pixel not found');
    }
    this.logger.log(`Pixel deleted at (${x}, ${y})`);

    const deletedPixel = result.raw[0];

    // Broadcast pixel deletion to all connected clients
    this.websocketGateway.broadcastPixelDelete(x, y);

    return deletedPixel;
  }

  // scheduled task to process buffered pixels
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processPendingPixels() {
    try {
      const bufferPattern = `${this.PIXEL_BUFFER_KEY}:*`;
      const keys = await this.redisClient.keys(bufferPattern);
      if (keys.length === 0) {
        this.logger.log('No pending pixels to process');
        return;
      }

      this.logger.log(`Processing ${keys.length} pending pixels`);

      //group by batch
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

    // Get all pixels in batch
    for (const key of keys) {
      const pixelData = await this.redisClient.get(key);
      if (pixelData) {
        pixels.push(JSON.parse(pixelData));
      }
    }

    if (pixels.length === 0) return;

    // Prepare bulk upsert
    const values = pixels.map((pixel) => ({
      x: pixel.x,
      y: pixel.y,
      color: pixel.color,
      insertedBy: pixel.insertedBy,
    }));

    try {
      // Bulk upsert to database
      await this.pixelRepository
        .createQueryBuilder()
        .insert()
        .into(Pixel)
        .values(values)
        .orUpdate(['color', 'inserted_by', 'updated_at'], ['x', 'y'])
        .execute();

      // Remove processed keys from buffer
      await this.redisClient.del(keys);

      this.logger.log(
        `Successfully processed batch of ${pixels.length} pixels`,
      );
    } catch (error) {
      this.logger.error('Error processing batch:', error);
    }
  }

  private async updatePixelCache(pixels: Pixel[]) {
    const pixelMap = {};

    pixels.forEach((pixel) => {
      pixelMap[`${pixel.x},${pixel.y}`] = JSON.stringify(
        this.toResponseDto(pixel),
      );
    });

    await this.redisClient.hset(this.PIXEL_GRID_KEY, pixelMap);
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
