import { ApiProperty } from '@nestjs/swagger';

export class PixelResponseDto {
  @ApiProperty()
  x: number;

  @ApiProperty()
  y: number;

  @ApiProperty()
  color: string;

  @ApiProperty()
  insertedBy: string;

  @ApiProperty()
  updatedAt: Date;
}