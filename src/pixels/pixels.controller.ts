import { Controller, Get, Post, Delete, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PixelsService } from './pixels.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { PixelResponseDto } from './dto/pixel-response.dto';
import { DeletePixelDto } from './dto/delete-pixel.dto';

@ApiTags('pixels')
@Controller('api/pixels')
export class PixelsController {
  constructor(private readonly pixelsService: PixelsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all pixels with metadata' })
  @ApiResponse({ status: 200, description: 'List of pixels', type: [PixelResponseDto] })
  async getAllPixels(): Promise<PixelResponseDto[]> {
    return this.pixelsService.getAllPixels();
  }

  @Post()
  @ApiOperation({ summary: 'Place or update a pixel' })
  @ApiResponse({ status: 201, description: 'Pixel created/updated', type: PixelResponseDto })
  async setPixel(@Body() createPixelDto: CreatePixelDto): Promise<PixelResponseDto> {
    return this.pixelsService.setPixel(createPixelDto);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete a pixel' })
  @ApiResponse({ status: 200, description: 'Pixel deleted successfully' })
  async deletePixel(@Body()deletePixelDto: DeletePixelDto): Promise<{ x: number; y: number }> {
    return this.pixelsService.deletePixel(deletePixelDto);
  }


  @Get('leaderboard')
  @ApiOperation({ summary: 'Get leaderboard data' })
  @ApiResponse({ status: 200, description: 'Leaderboard data' })
  async getLeaderboard() {
    return this.pixelsService.getLeaderboard();
  }


}