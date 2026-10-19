import { Controller, Post, Get, Query, Body, Logger, Param } from '@nestjs/common';
import { RapidApiCrawlerService } from './rapidapi-crawler.service.js';

@Controller('crawler')
export class CrawlerController {
  private readonly logger = new Logger(CrawlerController.name);

  constructor(private readonly crawlerService: RapidApiCrawlerService) {}

  /**
   * POST /api/v1/crawler/trigger?province=Đà Lạt
   * Kích hoạt cào dữ liệu tự động cho các địa bàn từ vietnamLocations
   * Mỗi địa bàn cào tối thiểu 15 homestay hợp lệ
   */
  @Post('trigger')
  async triggerCrawler(
    @Query('province') provinceQuery?: string,
    @Body('province') provinceBody?: string,
  ) {
    const province = provinceQuery || provinceBody || 'all';
    this.logger.log(`Nhận yêu cầu trigger cào tự động cho địa bàn: ${province}`);
    return await this.crawlerService.triggerTargetDrivenCrawl(province);
  }

  /**
   * POST /api/v1/crawler/reset-and-crawl
   * Xóa sạch toàn bộ homestays cũ trong DB và cào lại từ đầu 100% kèm review scores & grouped facilities
   */
  @Post('reset-and-crawl')
  async resetAndCrawl(@Query('min') minQuery?: string) {
    const min = minQuery ? parseInt(minQuery, 10) : 15;
    this.logger.warn(`Nhận yêu cầu RESET database và cào lại từ đầu (tối thiểu ${min} căn/tỉnh)`);
    return await this.crawlerService.resetAndCrawlAllFresh(min);
  }

  /**
   * GET /api/v1/crawler/progress
   * Theo dõi tiến độ cào toàn bộ các tỉnh thành Việt Nam
   */
  @Get('progress')
  getProgress() {
    return this.crawlerService.getCrawlProgress();
  }

  /**
   * GET /api/v1/crawler/stats
   * Kiểm tra số lượng homestay, phòng, ảnh đã cào và lưu thật trong CSDL MySQL
   */
  @Get('stats')
  async getStats() {
    return await this.crawlerService.getDatabaseCrawlStats();
  }

  /**
   * GET /api/v1/crawler/verify-urls
   * Kiểm tra live tính hoạt động của source_url dẫn sang Booking.com
   */
  @Get('verify-urls')
  async verifyUrls() {
    const stats = await this.crawlerService.getDatabaseCrawlStats();
    const results: Array<{
      id: string;
      name: string;
      source_url: string;
      status: number | string;
      is_working: boolean;
    }> = [];

    for (const item of stats.sample_items.slice(0, 5)) {
      if (!item.source_url) continue;
      try {
        const response = await fetch(item.source_url, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          redirect: 'follow',
        });
        results.push({
          id: item.id,
          name: item.name,
          source_url: item.source_url,
          status: response.status,
          is_working: response.status >= 200 && response.status < 400,
        });
      } catch (err: any) {
        results.push({
          id: item.id,
          name: item.name,
          source_url: item.source_url,
          status: err.message,
          is_working: false,
        });
      }
    }

    return {
      message: 'Kiểm tra hoạt động thực tế của source_url dẫn sang Booking.com',
      total_tested: results.length,
      all_working: results.every((r) => r.is_working),
      details: results,
    };
  }

  /**
   * POST /api/v1/crawler/enrich-homestay/:id
   * Làm giàu dữ liệu review_scores và grouped_facilities cho 1 homestay cụ thể
   */
  @Post('enrich-homestay/:id')
  async enrichHomestay(@Param('id') id: string) {
    return await this.crawlerService.enrichHomestayWithFacilitiesAndScores(id);
  }

  /**
   * POST /api/v1/crawler/enrich-amenities
   * Làm giàu dữ liệu review_scores và grouped_facilities cho toàn bộ homestays đã cào
   */
  @Post('enrich-amenities')
  async enrichAmenities(@Query('limit') limitQuery?: string) {
    const limit = limitQuery ? parseInt(limitQuery, 10) : 200;
    return await this.crawlerService.enrichAllExistingHomestays(limit);
  }

  /**
   * POST /api/v1/crawler/enrich-rooms
   * Làm giàu dữ liệu chi tiết phòng (area_sqm, bed_info, description, room_details_json, images)
   * cho toàn bộ các phòng đã có trong cơ sở dữ liệu MySQL
   */
  @Post('enrich-rooms')
  async enrichRooms(@Query('homestayId') homestayId?: string) {
    return await this.crawlerService.enrichRoomsDetail(homestayId);
  }

  @Get('enrich-rooms')
  async enrichRoomsGet(@Query('homestayId') homestayId?: string) {
    return await this.crawlerService.enrichRoomsDetail(homestayId);
  }
}
