import { PartialType } from '@nestjs/swagger';
import { CreateRediDto } from './create-redi.dto';

export class UpdateRediDto extends PartialType(CreateRediDto) {}
