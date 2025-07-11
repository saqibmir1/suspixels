import { ApiProperty } from "@nestjs/swagger";

export class DeletePixelDto {
    @ApiProperty({ description: 'X coordinate of the pixel to delete' })
    x: number;
    
    @ApiProperty({ description: 'Y coordinate of the pixel to delete' })
    y: number;
}