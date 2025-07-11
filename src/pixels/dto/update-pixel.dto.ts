import { PartialType } from '@nestjs/swagger';
import { CreatePixelDto } from './create-pixel.dto';

export class UpdatePixelDto extends PartialType(CreatePixelDto) {}
