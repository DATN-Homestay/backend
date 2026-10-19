import { Controller, Get, Param, Query } from '@nestjs/common';
import { HomestaysService } from './homestays.service.js';

@Controller('homestays')
export class HomestaysController {
  constructor(private readonly homestaysService: HomestaysService) {}

  @Get()
  async getHomestays(
    @Query('city') city?: string,
    @Query('limit') limit: number = 1000,
    @Query('offset') offset: number = 0,
  ) {
    return await this.homestaysService.findAll(city, Number(limit), Number(offset));
  }

  @Get(':id')
  async getHomestayDetail(@Param('id') id: string) {
    return await this.homestaysService.findOne(id);
  }
}
