import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RedisService } from './redis.service';
import { CreateRediDto } from './dto/create-redi.dto';
import { UpdateRediDto } from './dto/update-redi.dto';
import { ApiOperation } from '@nestjs/swagger';

@Controller('redis')
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Test Redis connection' })
  async ping() {
    return this.redisService.testFunction();
  }

  @Get('metrics')
  async getMetrics() {
    return this.redisService.getMetrics();
  }
}
