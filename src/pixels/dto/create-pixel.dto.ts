import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, Max, IsHexColor } from 'class-validator';

export class CreatePixelDto {
@ApiProperty({example: 199})
  @IsInt()
  x: number;

  @ApiProperty({example: 192})
  @IsInt()
  y: number;

  @ApiProperty({example: '#FF5733'})
  @IsString()
  @IsHexColor()
  color: string;

    @ApiProperty({example: 'Saqib Mir'})
  @IsString()
  insertedBy: string;
}