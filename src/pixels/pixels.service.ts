import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pixel } from './entities/pixel.entity';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { PixelResponseDto } from './dto/pixel-response.dto';
import { DeletePixelDto } from './dto/delete-pixel.dto';
import { WebsocketGateway } from './pixels.gateway';

@Injectable()
export class PixelsService {
  private readonly logger = new Logger(PixelsService.name);
  constructor(
    @InjectRepository(Pixel)
    private readonly pixelRepository: Repository<Pixel>,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  async getAllPixels(): Promise<PixelResponseDto[]> {
    const pixels = await this.pixelRepository.find({
      order: { updatedAt: 'DESC' },
    });
    return pixels.map(this.toResponseDto);
  }

  async setPixel(createPixelDto: CreatePixelDto): Promise<PixelResponseDto> {
    const { x, y, color, insertedBy } = createPixelDto;
    
    const result = await this.pixelRepository
      .createQueryBuilder()
      .insert()
      .into(Pixel)
      .values({ x, y, color, insertedBy })
      .orUpdate(['color', 'inserted_by', 'updated_at'], ['x', 'y'])
      .returning('*')
      .execute();

    const pixel = result.raw[0];
    this.logger.log(`Pixel set at (${x}, ${y}) by ${insertedBy} with color ${color}`);
    
    const responseDto = this.toResponseDto(pixel);
    
    // Broadcast pixel update to all connected clients
    this.websocketGateway.broadcastPixelUpdate(responseDto);
    
    return responseDto;
  }

  async deletePixel(deletePixelDto: DeletePixelDto): Promise<{ x: number; y: number }> {
    const { x, y } = deletePixelDto;
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


async getLeaderboard(): Promise<{ name: string; pixelCount: number }[]> {
  return this.pixelRepository
    .createQueryBuilder('pixel')
    .select('pixel.inserted_by', 'name')  
    .addSelect('COUNT(*)', 'pixelCount')
    .groupBy('pixel.inserted_by')       
    .orderBy('COUNT(*)', 'DESC')
    .limit(10)
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