import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PixelsModule } from './pixels/pixels.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import appConfig from './config/app.config';
import redisConfig from './config/redis.config';

@Module({
  imports: [
    PixelsModule,
    DatabaseModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, redisConfig],
    }),
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
