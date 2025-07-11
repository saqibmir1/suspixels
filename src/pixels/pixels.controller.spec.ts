import { Test, TestingModule } from '@nestjs/testing';
import { PixelsController } from './pixels.controller';
import { PixelsService } from './pixels.service';

describe('PixelsController', () => {
  let controller: PixelsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PixelsController],
      providers: [PixelsService],
    }).compile();

    controller = module.get<PixelsController>(PixelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
