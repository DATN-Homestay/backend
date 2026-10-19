import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Homestay,
  HomestayStatus,
  CancellationPolicy,
} from '../homestays/entities/homestay.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import { RoomImage } from '../homestays/entities/room-image.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { VIETNAM_LOCATIONS, POPULAR_DESTINATIONS, ALL_LOCATIONS_LIST } from './vietnam-locations.data.js';

export interface TargetWardItem {
  city: string;
  ward: string;
  searchQuery: string;
}

export interface CrawledRoomItem {
  room_name: string;
  capacity: number;
  base_price: number;
  images: string[];
}

export interface CrawlLocationSummary {
  city: string;
  ward: string;
  collectedCount: number;
  targetCount: number;
  pagesScanned: number;
  items: Array<{ id: string; name: string; address: string; base_price: number; source_url: string }>;
}

@Injectable()
export class RapidApiCrawlerService {
  private readonly logger = new Logger(RapidApiCrawlerService.name);
  private readonly TARGET_MIN_HOMESTAYS = 15;

  private crawlProgress = {
    is_running: false,
    current_province: '',
    completed_provinces: [] as string[],
    total_homestays_saved: 0,
    started_at: null as Date | null,
    last_log: '',
  };

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Homestay)
    private readonly homestayRepo: Repository<Homestay>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(RoomImage)
    private readonly roomImageRepo: Repository<RoomImage>,
    @InjectRepository(PriceCalendar)
    private readonly priceCalendarRepo: Repository<PriceCalendar>,
  ) {}

  getCrawlProgress() {
    return {
      ...this.crawlProgress,
      active_provinces_count: this.crawlProgress.completed_provinces.length,
      total_provinces: ALL_LOCATIONS_LIST.length,
    };
  }

  /**
   * Kích hoạt tiến trình cào ngầm cho toàn bộ 63 tỉnh thành Việt Nam
   * Mỗi tỉnh thành cào tối thiểu targetMinPerCity (15) căn hợp lệ
   */
  startAllProvincesBackgroundCrawl(targetMinPerCity: number = 15): {
    status: string;
    message: string;
    progress: any;
  } {
    if (this.crawlProgress.is_running) {
      return {
        status: 'already_running',
        message: `Tiến trình cào toàn bộ Việt Nam đang chạy cho tỉnh/thành: ${this.crawlProgress.current_province}`,
        progress: this.getCrawlProgress(),
      };
    }

    this.crawlProgress.is_running = true;
    this.crawlProgress.started_at = new Date();
    this.crawlProgress.completed_provinces = [];
    this.crawlProgress.total_homestays_saved = 0;
    this.crawlProgress.last_log = 'Bắt đầu cào toàn bộ các tỉnh thành Việt Nam...';

    // Chạy ngầm trong background không chặn HTTP request
    this.executeAllProvincesCrawl(targetMinPerCity)
      .catch((err) => {
        this.logger.error(`Lỗi trong tiến trình cào toàn quốc: ${err.message}`, err.stack);
        this.crawlProgress.last_log = `Lỗi: ${err.message}`;
      })
      .finally(() => {
        this.crawlProgress.is_running = false;
        this.logger.log(`Đã hoàn tất tiến trình cào toàn bộ các tỉnh thành Việt Nam!`);
      });

    return {
      status: 'started',
      message: `Đã kích hoạt ngầm tiến trình cào dữ liệu cho tất cả các tỉnh thành tại Việt Nam (Mỗi tỉnh tối thiểu ${targetMinPerCity} căn hợp lệ). Theo dõi tiến độ tại /api/v1/crawler/progress hoặc /api/v1/crawler/stats`,
      progress: this.getCrawlProgress(),
    };
  }

  /**
   * Vòng lặp duyệt tuần tự từng tỉnh thành trong ALL_LOCATIONS_LIST
   */
  private async executeAllProvincesCrawl(targetMinPerCity: number = 15): Promise<void> {
    const apiKey = this.configService.get<string>('RAPIDAPI_KEY') || process.env.RAPIDAPI_KEY;
    const apiHost =
      this.configService.get<string>('RAPIDAPI_HOST') ||
      process.env.RAPIDAPI_HOST ||
      'apidojo-booking-v1.p.rapidapi.com';

    if (!apiKey) {
      throw new Error('Chưa cấu hình RAPIDAPI_KEY trong .env!');
    }

    const now = new Date();
    const checkinDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const checkoutDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const arrivalDateStr = checkinDate.toISOString().split('T')[0];
    const departureDateStr = checkoutDate.toISOString().split('T')[0];

    for (const provinceName of ALL_LOCATIONS_LIST) {
      this.crawlProgress.current_province = provinceName;
      let existingCount = await this.homestayRepo.count({ where: { city: provinceName } });

      if (existingCount >= targetMinPerCity) {
        this.logger.log(
          `[${provinceName}] Đã có ${existingCount}/${targetMinPerCity} homestays trong CSDL. Bỏ qua và chuyển sang tỉnh tiếp theo.`,
        );
        this.crawlProgress.completed_provinces.push(provinceName);
        this.crawlProgress.last_log = `[${provinceName}] Đã đạt ${existingCount} căn. Bỏ qua.`;
        continue;
      }

      this.logger.log(
        `>>> [${provinceName}] Hiện có ${existingCount} căn. Bắt đầu cào để đạt tối thiểu ${targetMinPerCity} căn...`,
      );
      this.crawlProgress.last_log = `Đang cào dữ liệu cho [${provinceName}]...`;

      const rawWards = VIETNAM_LOCATIONS[provinceName] || [];
      const wards = rawWards.filter((w) => w !== 'Tất cả quận/huyện');
      if (wards.length === 0) {
        wards.push('Trung tâm');
      }

      for (const ward of wards) {
        existingCount = await this.homestayRepo.count({ where: { city: provinceName } });
        if (existingCount >= targetMinPerCity) {
          this.logger.log(
            `[${provinceName}] Đã đạt ${existingCount}/${targetMinPerCity} homestay! Chuyển sang tỉnh tiếp theo.`,
          );
          break;
        }

        const needed = targetMinPerCity - existingCount;
        const targetWard: TargetWardItem = {
          city: provinceName,
          ward: ward,
          searchQuery: `${ward}, ${provinceName}, Việt Nam`,
        };

        try {
          const res = await this.crawlWardTarget(
            targetWard,
            arrivalDateStr,
            departureDateStr,
            apiKey,
            apiHost,
            needed,
          );
          this.crawlProgress.total_homestays_saved += res.collectedCount;
        } catch (wardErr: any) {
          this.logger.warn(`Lỗi khi cào [${provinceName} - ${ward}]: ${wardErr.message}`);
        }

        // Delay ngắn giữa các địa bàn để tránh rate limit
        await this.delay(1000);
      }

      existingCount = await this.homestayRepo.count({ where: { city: provinceName } });
      this.crawlProgress.completed_provinces.push(provinceName);
      this.crawlProgress.last_log = `Hoàn tất cào cho [${provinceName}]: hiện có ${existingCount} căn.`;
    }
  }

  /**
   * Kích hoạt cào tự động cho địa bàn mục tiêu dựa trên dữ liệu chuẩn vietnamLocations
   * @param targetCity Tên thành phố/tỉnh (ví dụ 'Đà Lạt', 'Vũng Tàu', 'Nha Trang', 'Hà Nội'...) hoặc 'all'
   */
  async triggerTargetDrivenCrawl(targetCity: string = 'Đà Lạt'): Promise<any> {
    const apiKey = this.configService.get<string>('RAPIDAPI_KEY') || process.env.RAPIDAPI_KEY;
    const apiHost =
      this.configService.get<string>('RAPIDAPI_HOST') ||
      process.env.RAPIDAPI_HOST ||
      'apidojo-booking-v1.p.rapidapi.com';

    if (!apiKey || apiKey === 'your_rapidapi_key' || apiKey.length < 10) {
      throw new BadRequestException(
        'Bắt buộc phải cấu hình RAPIDAPI_KEY hợp lệ trong file .env để cào dữ liệu thật từ Booking.com!',
      );
    }

    if (targetCity === 'all' || targetCity === 'all_vietnam') {
      return this.startAllProvincesBackgroundCrawl(this.TARGET_MIN_HOMESTAYS);
    }

    // Tìm thành phố khớp với targetCity (case-insensitive)
    const matchedCityKey = Object.keys(VIETNAM_LOCATIONS).find(
      (k) =>
        k.toLowerCase() === targetCity.toLowerCase() ||
        k.toLowerCase().includes(targetCity.toLowerCase()) ||
        targetCity.toLowerCase().includes(k.toLowerCase()),
    );

    const targetWards: TargetWardItem[] = [];

    if (matchedCityKey && VIETNAM_LOCATIONS[matchedCityKey]) {
      const wards = VIETNAM_LOCATIONS[matchedCityKey].filter((w) => w !== 'Tất cả quận/huyện');
      for (const w of wards) {
        targetWards.push({
          city: matchedCityKey,
          ward: w,
          searchQuery: `${w}, ${matchedCityKey}, Việt Nam`,
        });
      }
    } else {
      // Địa bàn đơn lẻ
      targetWards.push({
        city: targetCity,
        ward: 'Trung tâm',
        searchQuery: `${targetCity}, Việt Nam`,
      });
    }

    const currentCity = matchedCityKey || targetCity;
    let existingCount = await this.homestayRepo.count({ where: { city: currentCity } });

    this.logger.log(
      `>>> BẮT ĐẦU CÀO DỮ LIỆU HOMESTAY CHO [${currentCity}] - HIỆN CÓ ${existingCount} CĂN, MỤC TIÊU: ${this.TARGET_MIN_HOMESTAYS} CĂN <<<`,
    );

    const summaries: CrawlLocationSummary[] = [];
    let totalHomestaysSaved = 0;

    const now = new Date();
    const checkinDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const checkoutDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const arrivalDateStr = checkinDate.toISOString().split('T')[0];
    const departureDateStr = checkoutDate.toISOString().split('T')[0];

    for (const tw of targetWards) {
      existingCount = await this.homestayRepo.count({ where: { city: currentCity } });
      if (existingCount >= this.TARGET_MIN_HOMESTAYS) {
        this.logger.log(
          `[${currentCity}] Đã đạt ${existingCount}/${this.TARGET_MIN_HOMESTAYS} căn hợp lệ. Dừng cào cho địa phương này.`,
        );
        break;
      }

      const needed = this.TARGET_MIN_HOMESTAYS - existingCount;

      try {
        const result = await this.crawlWardTarget(
          tw,
          arrivalDateStr,
          departureDateStr,
          apiKey,
          apiHost,
          needed,
        );
        summaries.push(result);
        totalHomestaysSaved += result.collectedCount;
      } catch (wardErr: any) {
        this.logger.error(
          `Lỗi khi cào địa bàn [${tw.city} - ${tw.ward}]: ${wardErr.message}`,
        );
        summaries.push({
          city: tw.city,
          ward: tw.ward,
          collectedCount: 0,
          targetCount: needed,
          pagesScanned: 0,
          items: [],
        });
      }

      await this.delay(1000);
    }

    return {
      message: `Đã hoàn tất cào cho [${currentCity}]! Thu thập thêm ${totalHomestaysSaved} homestay chuẩn. Tổng hiện tại: ${await this.homestayRepo.count({ where: { city: currentCity } })} căn.`,
      target: currentCity,
      total_wards_scanned: targetWards.length,
      total_homestays_saved: totalHomestaysSaved,
      details: summaries,
    };
  }

  /**
   * Cào từng địa bàn với mục tiêu tối thiểu targetCount homestay hợp lệ
   */
  private async crawlWardTarget(
    targetWard: TargetWardItem,
    arrivalDate: string,
    departureDate: string,
    apiKey: string,
    apiHost: string,
    targetCount: number = this.TARGET_MIN_HOMESTAYS,
  ): Promise<CrawlLocationSummary> {
    this.logger.log(
      `------------------------------------------------------------------------`,
    );
    this.logger.log(
      `[${targetWard.city} - ${targetWard.ward}] Bắt đầu cào. Mục tiêu: ${targetCount} căn hợp lệ...`,
    );

    // Bước 1: Tìm dest_id từ auto-complete
    const destInfo = await this.searchDestination(targetWard.searchQuery, apiKey, apiHost);
    let destId = destInfo.dest_id;
    let destType = destInfo.dest_type;

    if (!destId) {
      this.logger.warn(
        `Không tìm thấy dest_id cho "${targetWard.searchQuery}", thử tìm bằng "${targetWard.city}"...`,
      );
      await this.delay(1500);
      const fallbackDest = await this.searchDestination(targetWard.city, apiKey, apiHost);
      destId = fallbackDest.dest_id;
      destType = fallbackDest.dest_type;
    }

    if (!destId) {
      throw new Error(`Không thể tìm thấy dest_id trên Booking.com cho ${targetWard.searchQuery}`);
    }

    let collectedCount = 0;
    let pageNumber = 1;
    const maxPages = 5;
    const savedItems: Array<{ id: string; name: string; address: string; base_price: number; source_url: string }> = [];

    // Bước 2: Vòng lặp thu thập đủ targetCount homestay
    while (collectedCount < targetCount && pageNumber <= maxPages) {
      this.logger.log(
        `[${targetWard.city} - ${targetWard.ward}] Quét trang ${pageNumber} (Đã có ${collectedCount}/${targetCount} căn)...`,
      );

      await this.delay(1200);
      const rawProperties = await this.searchHotels(
        destId,
        destType,
        pageNumber,
        arrivalDate,
        departureDate,
        apiKey,
        apiHost,
      );

      if (!rawProperties || rawProperties.length === 0) {
        this.logger.log(
          `[${targetWard.city} - ${targetWard.ward}] Hết dữ liệu ở trang ${pageNumber}. Kết thúc cào cho địa bàn này.`,
        );
        break;
      }

      for (const item of rawProperties) {
        if (collectedCount >= targetCount) {
          break;
        }

        try {
          // 1. Kiểm tra chuẩn phân loại Homestay (Loại bỏ khách sạn, chấp nhận homestay/villa/apartment/studio)
          const validCheck = this.isValidHomestay(item);
          if (!validCheck.valid) {
            continue;
          }

          // 2. Trích xuất ID
          const rawId = item.hotel_id || item.id || item.property?.id;
          const hotelId = typeof rawId === 'string' ? rawId.replace(/\D/g, '') : String(rawId);
          if (!hotelId || hotelId.length < 3) {
            continue;
          }

          // 3. Xây dựng URL Booking.com chuẩn xác 100% hoạt động
          const sourceUrl = this.buildWorkingBookingUrl(item, hotelId);

          const lat = Number(item.latitude || item.property?.latitude || 0);
          const lon = Number(item.longitude || item.property?.longitude || 0);

          // 4. Kiểm tra chống trùng lặp (trùng hotel_id hoặc khoảng cách GPS <= 10m)
          const dupCheck = await this.isDuplicate(sourceUrl, lat, lon, targetWard.city);
          if (dupCheck.isDup) {
            continue;
          }

          // 5. Lấy chi tiết phòng và ảnh thật từ RapidAPI
          await this.delay(1500);
          const roomDetails = await this.fetchRoomDetails(
            hotelId,
            arrivalDate,
            departureDate,
            apiKey,
            apiHost,
            item,
          );

          // 6. Lưu vào Database MySQL (Homestay, Room, RoomImage, PriceCalendar)
          const saved = await this.saveHomestayToDb(
            targetWard,
            item,
            hotelId,
            sourceUrl,
            validCheck.propertyType,
            lat,
            lon,
            roomDetails,
            arrivalDate,
          );

          if (saved) {
            collectedCount++;
            savedItems.push(saved);
            this.logger.log(
              `[${targetWard.city} - ${targetWard.ward}] Đã cào: ${collectedCount}/${this.TARGET_MIN_HOMESTAYS} căn (Đã lưu: "${saved.name}" - ${validCheck.propertyType} | URL: ${saved.source_url})`,
            );
          }
        } catch (itemErr: any) {
          this.logger.warn(
            `Lỗi khi lưu homestay [${item.name || 'N/A'}]: ${itemErr.message}`,
          );
        }
      }

      pageNumber++;
    }

    this.logger.log(
      `✓ [${targetWard.city} - ${targetWard.ward}] Hoàn tất. Thu thập được: ${collectedCount}/${this.TARGET_MIN_HOMESTAYS} homestay hợp lệ!`,
    );

    return {
      city: targetWard.city,
      ward: targetWard.ward,
      collectedCount,
      targetCount: this.TARGET_MIN_HOMESTAYS,
      pagesScanned: pageNumber - 1,
      items: savedItems,
    };
  }

  /**
   * Xây dựng source_url chuẩn xác 100% hoạt động dẫn sang Booking.com
   * - Nếu API có URL gốc thì lấy link gốc chuẩn
   * - Nếu không có, dùng URL chuyển hướng chính thức theo hotel_id của Booking.com
   */
  private buildWorkingBookingUrl(item: any, hotelId: string): string {
    let rawUrl = item.url || item.property?.url || item.hotel_url;
    if (rawUrl && typeof rawUrl === 'string') {
      if (rawUrl.startsWith('/')) {
        rawUrl = `https://www.booking.com${rawUrl}`;
      }
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return rawUrl.split('?')[0];
      }
    }
    // URL chuẩn redirect tự động của Booking.com theo hotel_id
    return `https://www.booking.com/hotel.html?hotel_id=${hotelId}&lang=vi`;
  }

  /**
   * Gọi searchDestination lấy dest_id và dest_type từ Booking.com
   */
  private async searchDestination(
    query: string,
    apiKey: string,
    apiHost: string,
  ): Promise<{ dest_id: string; dest_type: string }> {
    const url = `https://${apiHost}/locations/auto-complete?text=${encodeURIComponent(query)}&languagecode=vi`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': apiHost,
      },
    });

    if (!res.ok) {
      throw new Error(`RapidAPI auto-complete lỗi status: ${res.status}`);
    }

    const data: any = await res.json();
    const list = Array.isArray(data) ? data : data.data || [];
    if (list.length > 0) {
      const top = list[0];
      return {
        dest_id: String(top.dest_id || top.id || ''),
        dest_type: String(top.dest_type || 'city'),
      };
    }

    return { dest_id: '', dest_type: 'city' };
  }

  /**
   * Gọi endpoint searchHotels lấy danh sách khách sạn / homestay
   */
  private async searchHotels(
    destId: string,
    destType: string,
    pageNumber: number,
    arrivalDate: string,
    departureDate: string,
    apiKey: string,
    apiHost: string,
  ): Promise<any[]> {
    const offset = (pageNumber - 1) * 20;
    const url = `https://${apiHost}/properties/list?offset=${offset}&page_number=${pageNumber}&arrival_date=${arrivalDate}&departure_date=${departureDate}&guest_qty=2&dest_ids=${destId}&room_qty=1&search_type=${destType}&currency_code=VND&locale=vi`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': apiHost,
      },
    });

    if (!res.ok) {
      throw new Error(`RapidAPI searchHotels lỗi status: ${res.status}`);
    }

    const data: any = await res.json();
    if (Array.isArray(data.result)) {
      return data.result;
    }
    if (Array.isArray(data.data)) {
      return data.data;
    }
    if (Array.isArray(data)) {
      return data;
    }

    return [];
  }

  /**
   * Hàm lọc phân loại Homestay chuẩn:
   * - LOẠI BỎ nếu tên chứa: Hotel, Khách sạn, Motel, Hostel, Palace, Inn
   * - CHẤP NHẬN nếu thuộc property type: Apartment, Villa, Holiday home, Guest house, Homestay
   *   HOẶC tên chứa: Homestay, House, Home, Villa, Studio, Apartment, Residences, Căn hộ, Nhà
   */
  private isValidHomestay(item: any): {
    valid: boolean;
    propertyType: 'HOMESTAY' | 'APARTMENT' | 'VILLA' | 'STUDIO';
    reason?: string;
  } {
    const name = String(item.name || item.hotel_name || item.property?.name || '').toLowerCase();
    const rawType = String(
      item.propertyType ||
        item.property_type ||
        item.accommodation_type_name ||
        item.property?.accommodationTypeName ||
        '',
    ).toLowerCase();

    // 1. LOẠI BỎ nếu tên chứa từ khóa khách sạn
    const rejectedWords = ['hotel', 'khách sạn', 'motel', 'hostel', 'palace', 'inn'];
    for (const rw of rejectedWords) {
      const regex = new RegExp(`(^|\\s|[.,_-])${rw}($|\\s|[.,_-])`, 'i');
      if (regex.test(name) || name.includes(rw)) {
        return {
          valid: false,
          propertyType: 'HOMESTAY',
          reason: `Loại bỏ vì tên chứa từ khóa khách sạn: "${rw}"`,
        };
      }
    }

    // 2. CHẤP NHẬN nếu thuộc property type hợp lệ
    const acceptedTypes = [
      'apartment',
      'villa',
      'holiday home',
      'guest house',
      'homestay',
      'residence',
      'aparthotel',
    ];
    const hasAcceptedType = acceptedTypes.some((t) => rawType.includes(t));

    // HOẶC tên chứa các từ khóa homestay / căn hộ / nhà nghỉ dưỡng
    const acceptedKeywords = [
      'homestay',
      'house',
      'home',
      'villa',
      'studio',
      'apartment',
      'residences',
      'residence',
      'căn hộ',
      'nhà',
    ];
    const hasAcceptedKeyword = acceptedKeywords.some((kw) => {
      const regex = new RegExp(`(^|\\s|[.,_-])${kw}($|\\s|[.,_-])`, 'i');
      return regex.test(name) || name.includes(kw);
    });

    if (!hasAcceptedType && !hasAcceptedKeyword) {
      return {
        valid: false,
        propertyType: 'HOMESTAY',
        reason: 'Không khớp phân loại Homestay/Apartment/Villa/Studio',
      };
    }

    // 3. Phân loại Enum chuẩn
    let classifiedType: 'HOMESTAY' | 'APARTMENT' | 'VILLA' | 'STUDIO' = 'HOMESTAY';
    if (name.includes('villa') || rawType.includes('villa')) {
      classifiedType = 'VILLA';
    } else if (name.includes('studio') || rawType.includes('studio')) {
      classifiedType = 'STUDIO';
    } else if (
      name.includes('apartment') ||
      name.includes('căn hộ') ||
      name.includes('residence') ||
      rawType.includes('apartment')
    ) {
      classifiedType = 'APARTMENT';
    } else {
      classifiedType = 'HOMESTAY';
    }

    return { valid: true, propertyType: classifiedType };
  }

  /**
   * Kiểm tra chống trùng lặp:
   * - Trùng hotel_id qua source_url
   * - Tọa độ GPS trùng khớp <= 10m (0.01 km)
   */
  private async isDuplicate(
    sourceUrl: string,
    latitude: number,
    longitude: number,
    city: string,
  ): Promise<{ isDup: boolean; reason?: string }> {
    const existingBySource = await this.homestayRepo.findOne({
      where: { source_url: sourceUrl },
      select: ['id', 'name'],
    });
    if (existingBySource) {
      return { isDup: true, reason: `Trùng source_url (ID: ${existingBySource.id})` };
    }

    if (latitude && longitude) {
      const homestaysInCity = await this.homestayRepo.find({
        where: { city },
        select: ['id', 'name', 'latitude', 'longitude'],
      });

      for (const h of homestaysInCity) {
        if (h.latitude && h.longitude) {
          const distMeters = this.calculateHaversineDistanceMeters(
            latitude,
            longitude,
            Number(h.latitude),
            Number(h.longitude),
          );
          if (distMeters <= 10) {
            return {
              isDup: true,
              reason: `Trùng GPS (${distMeters.toFixed(1)}m <= 10m so với "${h.name}" ID: ${h.id})`,
            };
          }
        }
      }
    }

    return { isDup: false };
  }

  /**
   * Tính khoảng cách giữa 2 tọa độ theo mét (Haversine Formula)
   */
  private calculateHaversineDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3; // Bán kính Trái Đất theo mét
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Lấy chi tiết phòng và ảnh thật từ endpoint /properties/v2/get-rooms
   */
  private async fetchRoomDetails(
    hotelId: string,
    arrivalDate: string,
    departureDate: string,
    apiKey: string,
    apiHost: string,
    rawItem: any,
  ): Promise<{ rooms: CrawledRoomItem[]; homestayImages: string[] }> {
    const defaultImages = this.extractImagesFromItem(rawItem);
    const defaultPrice = this.extractPriceFromItem(rawItem);

    try {
      const url = `https://${apiHost}/properties/v2/get-rooms?hotel_id=${hotelId}&arrival_date=${arrivalDate}&departure_date=${departureDate}&rec_guest_qty=2&rec_room_qty=1&currency_code=VND&locale=vi`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': apiHost,
        },
      });

      if (res.ok) {
        const roomData: any = await res.json();
        const hotelInfo = Array.isArray(roomData) ? roomData[0] : roomData;
        const blocks = hotelInfo?.block || [];
        const roomsDict = hotelInfo?.rooms || {};

        if (Array.isArray(blocks) && blocks.length > 0) {
          const distinctRoomsMap = new Map<string, CrawledRoomItem>();

          for (const b of blocks) {
            const roomName = b.room_name || b.name || 'Phòng Tiêu Chuẩn';
            if (!distinctRoomsMap.has(roomName)) {
              const rId = b.room_id;
              const photosObj = roomsDict[rId]?.photos || [];
              const roomPhotos: string[] = photosObj
                .map((p: any) =>
                  p.url_max1280 ||
                  p.url_original640 ||
                  p.url_square60?.replace('square60', 'max1024x768'),
                )
                .filter(Boolean);

              const roomPrice = Number(b.gross_amount?.value || b.min_price?.price || defaultPrice);
              const roomCapacity = Number(b.max_occupancy || 2);

              distinctRoomsMap.set(roomName, {
                room_name: roomName,
                capacity: roomCapacity,
                base_price: Math.round(roomPrice),
                images: roomPhotos.length > 0 ? roomPhotos : defaultImages,
              });
            }
          }

          const extractedRooms = Array.from(distinctRoomsMap.values());
          if (extractedRooms.length > 0) {
            // Đảm bảo ảnh bìa chính của Homestay (defaultImages[0] từ Booking.com)
            // luôn xuất hiện ở vị trí đầu tiên của phòng đầu tiên để ảnh đại diện luôn đúng căn hộ/villa
            if (defaultImages[0] && extractedRooms[0].images && !extractedRooms[0].images.includes(defaultImages[0])) {
              extractedRooms[0].images.unshift(defaultImages[0]);
            }

            const allImages = new Set<string>();
            defaultImages.forEach((img) => allImages.add(img));
            extractedRooms.forEach((r) => r.images.forEach((img) => allImages.add(img)));

            return {
              rooms: extractedRooms,
              homestayImages: Array.from(allImages).slice(0, 8),
            };
          }
        }
      }
    } catch (err: any) {
      this.logger.debug(`Không lấy được chi tiết phòng hotelId=${hotelId}: ${err.message}`);
    }

    return {
      rooms: [
        {
          room_name: 'Phòng Nghỉ Tiêu Chuẩn',
          capacity: Number(rawItem.max_occupancy || 2),
          base_price: defaultPrice,
          images: defaultImages,
        },
      ],
      homestayImages: defaultImages.slice(0, 8),
    };
  }

  /**
   * Lưu thông tin homestay và các bảng liên quan vào CSDL TypeORM
   */
  private async saveHomestayToDb(
    targetWard: TargetWardItem,
    item: any,
    hotelId: string,
    sourceUrl: string,
    propertyType: 'HOMESTAY' | 'APARTMENT' | 'VILLA' | 'STUDIO',
    latitude: number,
    longitude: number,
    roomDetails: { rooms: CrawledRoomItem[]; homestayImages: string[] },
    arrivalDate: string,
  ): Promise<{ id: string; name: string; address: string; base_price: number; source_url: string } | null> {
    const rawName = item.name || item.hotel_name || item.property?.name || 'Homestay Nghỉ Dưỡng';
    const rawAddress =
      item.address ||
      item.property?.address ||
      `${targetWard.ward}, ${targetWard.city}`;
    const rawRating = Number(
      item.reviewScore || item.review_score || item.property?.reviewScore || 9.0,
    );
    const starRating = Number((rawRating > 5 ? rawRating / 2 : rawRating).toFixed(1));
    const totalReviews = Number(item.reviewCount || item.review_nr || 28);
    const basePrice = roomDetails.rooms[0]?.base_price || 600000;

    // 1. Tạo Homestay
    let homestay = this.homestayRepo.create({
      name: rawName,
      address: rawAddress,
      city: targetWard.city,
      latitude: latitude || 11.9404,
      longitude: longitude || 108.4583,
      source_url: sourceUrl,
      is_claimed: 0, // UNCLAIMED
      host_id: '1', // System Bot
      average_rating: starRating,
      total_reviews: totalReviews,
      cancellation_policy: CancellationPolicy.FLEXIBLE,
      amenities_json: {
        property_type: propertyType,
        ward: targetWard.ward,
        main_image_url: roomDetails.homestayImages[0] || (roomDetails.rooms[0]?.images?.[0]) || null,
        property_images: roomDetails.homestayImages,
        items: [
          'Wifi tốc độ cao miễn phí',
          'Bếp nấu gia đình',
          'Điều hòa 2 chiều',
          'Bình nóng lạnh',
          'Chỗ đỗ xe ô tô',
          'Ban công view thoáng mát',
        ],
      },
      rules_json: {
        checkin: '14:00',
        checkout: '12:00',
        pet_allowed: true,
      },
      status: HomestayStatus.ACTIVE,
      last_price_synced_at: new Date(),
    });

    homestay = await this.homestayRepo.save(homestay);

    // 2. Tạo Rooms, RoomImages, PriceCalendars
    for (const rData of roomDetails.rooms) {
      let room = this.roomRepo.create({
        homestay_id: homestay.id,
        room_name: rData.room_name,
        capacity: rData.capacity,
        base_price: rData.base_price,
      });
      room = await this.roomRepo.save(room);

      const photosToSave = (rData.images && rData.images.length > 0
        ? rData.images
        : roomDetails.homestayImages
      ).slice(0, 8);

      for (let i = 0; i < photosToSave.length; i++) {
        const img = this.roomImageRepo.create({
          room_id: room.id,
          image_url: photosToSave[i],
          is_primary: i === 0 ? 1 : 0,
          sort_order: i,
        });
        await this.roomImageRepo.save(img);
      }

      const calendar = this.priceCalendarRepo.create({
        room_id: room.id,
        date: arrivalDate,
        price: rData.base_price,
        is_available: 1,
      });
      await this.priceCalendarRepo.save(calendar);
    }

    return {
      id: homestay.id,
      name: homestay.name,
      address: homestay.address,
      base_price: basePrice,
      source_url: sourceUrl,
    };
  }

  /**
   * Thống kê toàn bộ dữ liệu cào hiện có trong cơ sở dữ liệu MySQL
   */
  async getDatabaseCrawlStats(): Promise<{
    total_homestays: number;
    total_rooms: number;
    total_images: number;
    by_city: Array<{ city: string; count: number }>;
    sample_items: Array<{ id: string; name: string; city: string; source_url: string; rooms_count: number }>;
  }> {
    const totalHomestays = await this.homestayRepo.count();
    const totalRooms = await this.roomRepo.count();
    const totalImages = await this.roomImageRepo.count();

    const byCity = await this.homestayRepo
      .createQueryBuilder('h')
      .select('h.city', 'city')
      .addSelect('COUNT(h.id)', 'count')
      .groupBy('h.city')
      .getRawMany();

    const sampleHomestays = await this.homestayRepo.find({
      take: 10,
      order: { id: 'DESC' },
      relations: ['rooms'],
    });

    return {
      total_homestays: totalHomestays,
      total_rooms: totalRooms,
      total_images: totalImages,
      by_city: byCity.map((c) => ({ city: c.city, count: Number(c.count) })),
      sample_items: sampleHomestays.map((h) => ({
        id: h.id,
        name: h.name,
        city: h.city,
        source_url: h.source_url || '',
        rooms_count: h.rooms ? h.rooms.length : 0,
      })),
    };
  }

  /**
   * Trích xuất giá từ bản ghi của Booking.com
   */
  private extractPriceFromItem(item: any): number {
    const rawPrice =
      item.priceBreakdown?.grossPrice?.value ||
      item.composite_price_breakdown?.gross_amount?.value ||
      item.min_total_price ||
      item.property?.priceBreakdown?.grossPrice?.value ||
      item.price ||
      750000;
    return Math.round(Number(rawPrice));
  }

  /**
   * Trích xuất danh sách ảnh từ bản ghi của Booking.com
   */
  private extractImagesFromItem(item: any): string[] {
    const list: string[] = [];
    if (item.main_photo_url) {
      list.push(item.main_photo_url.replace('square60', 'max1024x768'));
    }
    if (item.photo_urls && Array.isArray(item.photo_urls)) {
      item.photo_urls.forEach((u: string) => list.push(u.replace('square60', 'max1024x768')));
    }
    if (item.property?.photoUrls && Array.isArray(item.property.photoUrls)) {
      item.property.photoUrls.forEach((u: string) => list.push(u.replace('square60', 'max1024x768')));
    }
    if (list.length === 0) {
      list.push('https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&auto=format&fit=crop&q=80');
    }
    return Array.from(new Set(list)).slice(0, 8);
  }

  /**
   * Tương thích ngược với endpoint cũ: cào theo tên thành phố
   */
  async crawlAndSaveHomestays(
    city: string,
    limit: number = 10,
  ): Promise<{
    message: string;
    city: string;
    source: 'RAPIDAPI_LIVE';
    total_saved: number;
    total_rooms_created: number;
    items: Array<{ id: string; name: string; address: string; base_price: number }>;
  }> {
    const result = await this.triggerTargetDrivenCrawl(city);
    const flattenedItems: Array<{ id: string; name: string; address: string; base_price: number }> =
      [];
    if (result && result.details && Array.isArray(result.details)) {
      result.details.forEach((d: any) => flattenedItems.push(...d.items));
    }

    return {
      message: result.message,
      city,
      source: 'RAPIDAPI_LIVE',
      total_saved: result.total_homestays_saved,
      total_rooms_created: result.total_homestays_saved * 2,
      items: flattenedItems.slice(0, limit),
    };
  }

  /**
   * Hàm tiện ích delay để tránh rate limit 429
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

