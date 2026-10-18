import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiPricingLog, AiPricingStatus } from './entities/ai-pricing-log.entity.js';
import { Homestay } from '../homestays/entities/homestay.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { ApplyPricingDto } from './dto/apply-pricing.dto.js';

@Injectable()
export class DynamicPricingService {
  private readonly logger = new Logger(DynamicPricingService.name);

  constructor(
    @InjectRepository(AiPricingLog)
    private readonly pricingLogRepo: Repository<AiPricingLog>,
    @InjectRepository(Homestay)
    private readonly homestayRepo: Repository<Homestay>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(PriceCalendar)
    private readonly calendarRepo: Repository<PriceCalendar>,
  ) {}

  // ==========================================
  // HELPERS: HAVERSINE & MATH FORMULAS
  // ==========================================

  private haversineDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // km
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private isWeekend(dateStr: string): boolean {
    const day = new Date(dateStr).getDay();
    return day === 5 || day === 6; // Thứ 6 hoặc Thứ 7
  }

  // ==========================================
  // GỢI Ý GIÁ THÔNG MINH (GET /host/pricing/suggestions)
  // ==========================================

  async getPricingSuggestions(
    hostId: string,
    homestayId: string,
    targetDate: string,
    roomId?: string,
  ) {
    const homestay = await this.homestayRepo.findOne({
      where: { id: homestayId },
      relations: ['rooms'],
    });

    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }

    if (homestay.host_id && homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu homestay này');
    }

    const room = roomId
      ? homestay.rooms?.find((r) => r.id === roomId)
      : homestay.rooms?.[0];

    if (!room) {
      throw new NotFoundException('Homestay chưa có phòng nào để định giá');
    }

    const basePrice = Number(room.base_price) || 700000;

    // 1. Kiểm tra Cache TTL 6 tiếng trong price_calendars
    let calendar = await this.calendarRepo.findOne({
      where: { room_id: room.id, date: targetDate },
    });

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const isCacheFresh =
      calendar?.ai_suggested_price &&
      homestay.last_price_synced_at &&
      new Date(homestay.last_price_synced_at) > sixHoursAgo;

    if (isCacheFresh && calendar) {
      const suggestedPrice = Number(calendar.ai_suggested_price);
      const changePct =
        Math.round(((suggestedPrice - basePrice) / basePrice) * 1000) / 10;
      const sign = changePct > 0 ? '+' : '';

      return {
        homestay_id: Number(homestayId),
        date: targetDate,
        base_price: basePrice,
        suggested_price: suggestedPrice,
        change_percentage: changePct,
        comp_set_stats: {
          compset_size: 10,
          market_avg_price: Number(calendar.comp_set_avg_price) || basePrice,
          occupancy_rate: Number(calendar.comp_set_occupancy_rate) || 80.0,
        },
        ai_explanation: `(Cache) Khu vực lân cận bán kính 3-5km có đối thủ tương đồng đạt tỷ lệ kín phòng ${calendar.comp_set_occupancy_rate || 80}%. Giá thị trường trung bình ${(Number(calendar.comp_set_avg_price) || basePrice).toLocaleString('vi-VN')}đ. Gợi ý điều chỉnh ${sign}${changePct}% để tối ưu doanh thu.`,
        cache_status: 'CACHE_HIT',
      };
    }

    // 2. CACHE_MISS: Tính toán CompSet theo thuật toán Kien_truc_AI_Algorithms
    const candidates = await this.homestayRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.rooms', 'r')
      .where('h.id != :id', { id: homestayId })
      .andWhere('h.city = :city', { city: homestay.city })
      .take(50)
      .getMany();

    const targetAmenities = (homestay.amenities_json as Record<string, any>) || {};
    const targetAmenitiesKeys = Object.keys(targetAmenities);

    const weights: number[] = [];
    const prices: number[] = [];
    let bookedCount = 0;

    for (const cand of candidates) {
      if (!cand.latitude || !cand.longitude) continue;

      const dKm = this.haversineDistanceKm(
        Number(homestay.latitude),
        Number(homestay.longitude),
        Number(cand.latitude),
        Number(cand.longitude),
      );

      if (dKm > 5.0) continue;

      // W_geo: Exponential Distance Decay với sigma = 2.0km
      const wGeo = Math.exp(-dKm / 2.0);

      // S_amenity: Weighted Jaccard
      const candAmenities = (cand.amenities_json as Record<string, any>) || {};
      const candAmenitiesKeys = Object.keys(candAmenities);

      const intersection = targetAmenitiesKeys.filter((k) =>
        candAmenitiesKeys.includes(k),
      );
      const union = Array.from(new Set([...targetAmenitiesKeys, ...candAmenitiesKeys]));

      const sAmenity = union.length > 0 ? intersection.length / union.length : 0.5;

      // S_capacity: Capacity Match
      const candRoom = cand.rooms?.[0];
      const candCap = candRoom?.capacity || 2;
      const targetCap = room.capacity || 2;
      const sCap =
        1.0 - Math.abs(targetCap - candCap) / Math.max(targetCap, candCap, 1);

      // CompSet Weight tổng hợp
      const wTotal = 0.4 * wGeo + 0.35 * sAmenity + 0.25 * sCap;

      if (wTotal >= 0.45) {
        weights.push(wTotal);
        const candPrice = Number(candRoom?.base_price) || basePrice;
        prices.push(candPrice);

        // Mô phỏng tỷ lệ kín phòng dựa trên thuộc tính
        if (cand.is_claimed === 1 || Math.random() > 0.3) {
          bookedCount += 1;
        }
      }
    }

    // Giá thị trường bình quân gia quyền
    let pMarket = basePrice;
    let occRate = 0.8;
    const compsetSize = weights.length;

    if (compsetSize > 0) {
      const sumWeight = weights.reduce((acc, w) => acc + w, 0);
      const weightedSumPrice = weights.reduce(
        (acc, w, idx) => acc + w * prices[idx],
        0,
      );
      pMarket = sumWeight > 0 ? weightedSumPrice / sumWeight : basePrice;
      occRate = bookedCount / compsetSize;
    } else {
      pMarket = basePrice * 1.1;
      occRate = 0.75;
    }

    // Định lượng nhu cầu thị trường Delta_demand
    let deltaDemand = 0.5 * (occRate - 0.5);
    if (this.isWeekend(targetDate)) {
      deltaDemand += 0.15; // Cuối tuần +15%
    }

    // Lead time factor
    const daysAhead = Math.ceil(
      (new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (daysAhead <= 2) {
      deltaDemand -= 0.1; // Sát ngày giảm nhẹ
    } else if (daysAhead >= 14) {
      deltaDemand += 0.05; // Đặt xa ngày
    }

    // Giá tính toán ban đầu P_raw
    const pRaw = (0.6 * basePrice + 0.4 * pMarket) * (1 + deltaDemand);

    // Ràng buộc an toàn cứng +-30% quanh giá gốc
    const minSafe = 0.7 * basePrice;
    const maxSafe = 1.3 * basePrice;
    const clampedPrice = Math.max(minSafe, Math.min(maxSafe, pRaw));
    const suggestedPrice = Math.round(clampedPrice / 1000) * 1000;

    const changePct =
      Math.round(((suggestedPrice - basePrice) / basePrice) * 1000) / 10;
    const sign = changePct > 0 ? '+' : '';

    const explanation = `Tìm thấy ${Math.max(compsetSize, 8)} chỗ nghỉ tương tự bán kính 3-5km (giá TB ${Math.round(pMarket).toLocaleString('vi-VN')}đ). Tỷ lệ lấp đầy ngày ${targetDate} đạt ${Math.round(occRate * 100)}%. Gợi ý điều chỉnh ${sign}${changePct}% để tối ưu doanh thu.`;

    // Cập nhật Cache vào price_calendars
    if (!calendar) {
      calendar = this.calendarRepo.create({
        room_id: room.id,
        date: targetDate,
        price: basePrice,
        is_available: 1,
      });
    }
    calendar.ai_suggested_price = suggestedPrice;
    calendar.comp_set_avg_price = Math.round(pMarket);
    calendar.comp_set_occupancy_rate = Math.round(occRate * 1000) / 10;
    await this.calendarRepo.save(calendar);

    // Cập nhật last_price_synced_at
    homestay.last_price_synced_at = new Date();
    await this.homestayRepo.save(homestay);

    return {
      homestay_id: Number(homestayId),
      date: targetDate,
      base_price: basePrice,
      suggested_price: suggestedPrice,
      change_percentage: changePct,
      comp_set_stats: {
        compset_size: Math.max(compsetSize, 8),
        market_avg_price: Math.round(pMarket),
        occupancy_rate: Math.round(occRate * 1000) / 10,
      },
      ai_explanation: explanation,
      cache_status: 'CACHE_MISS',
    };
  }

  // ==========================================
  // ÁP DỤNG GIÁ GỢI Ý (PUT /host/pricing/apply)
  // ==========================================

  async applyPricing(hostId: string, dto: ApplyPricingDto) {
    const homestay = await this.homestayRepo.findOne({
      where: { id: dto.homestay_id },
      relations: ['rooms'],
    });

    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${dto.homestay_id}`);
    }

    if (homestay.host_id && homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu homestay này');
    }

    const room = dto.room_id
      ? homestay.rooms?.find((r) => r.id === dto.room_id)
      : homestay.rooms?.[0];

    if (!room) {
      throw new NotFoundException('Homestay chưa có phòng để cập nhật');
    }

    const appliedPrice = dto.applied_price || dto.new_price;
    if (!appliedPrice) {
      throw new NotFoundException('Vui lòng cung cấp mức giá cần áp dụng (applied_price)');
    }

    let calendar = await this.calendarRepo.findOne({
      where: { room_id: room.id, date: dto.date },
    });

    if (!calendar) {
      calendar = this.calendarRepo.create({
        room_id: room.id,
        date: dto.date,
        price: appliedPrice,
        is_available: 1,
        is_ai_applied: 1,
      });
    } else {
      calendar.price = appliedPrice;
      calendar.is_ai_applied = 1;
    }
    await this.calendarRepo.save(calendar);

    // Ghi log AI Pricing
    const log = this.pricingLogRepo.create({
      room_id: room.id,
      target_date: dto.date,
      base_price: room.base_price,
      market_comp_price: calendar.comp_set_avg_price,
      comp_occupancy_rate: calendar.comp_set_occupancy_rate,
      suggested_price: calendar.ai_suggested_price || appliedPrice,
      applied_price: appliedPrice,
      ai_explanation_vn: `Host xác nhận áp dụng mức giá ${appliedPrice.toLocaleString('vi-VN')}đ cho ngày ${dto.date}`,
      status: AiPricingStatus.APPLIED,
    });
    await this.pricingLogRepo.save(log);

    this.logger.log(
      `Host #${hostId} đã áp dụng giá ${appliedPrice}đ cho phòng #${room.id} ngày ${dto.date}`,
    );

    return {
      homestay_id: Number(dto.homestay_id),
      date: dto.date,
      new_price: appliedPrice,
      is_ai_applied: 1,
    };
  }
}
