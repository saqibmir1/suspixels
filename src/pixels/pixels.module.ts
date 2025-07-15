import { Module } from '@nestjs/common';
import { PixelsService } from './pixels.service';
import { PixelsController } from './pixels.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pixel } from './entities/pixel.entity';
import { WebsocketGateway } from './pixels.gateway';
import { RedisModule } from 'src/redis/redis.module';
import { RedisService } from 'src/redis/redis.service';

@Module({
  imports: [TypeOrmModule.forFeature([Pixel]), RedisModule],
  controllers: [PixelsController],
  providers: [PixelsService, WebsocketGateway, RedisService],
})
export class PixelsModule {}
