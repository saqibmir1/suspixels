import { Module } from '@nestjs/common';
import { PixelsService } from './pixels.service';
import { PixelsController } from './pixels.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pixel } from './entities/pixel.entity';
import { WebsocketGateway } from './pixels.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Pixel])],
  controllers: [PixelsController],
  providers: [PixelsService, WebsocketGateway],
})
export class PixelsModule {}
