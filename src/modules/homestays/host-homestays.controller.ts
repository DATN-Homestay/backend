import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HomestaysService } from './homestays.service.js';
import { CreateHomestayDto } from './dto/create-homestay.dto.js';
import { UpdateHomestayDto } from './dto/update-homestay.dto.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';
import { UploadRoomImageDto } from './dto/upload-room-image.dto.js';
import { UpdateCalendarDto } from './dto/update-calendar.dto.js';
import { BatchUpdateCalendarDto } from './dto/batch-update-calendar.dto.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

@Controller('host')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.HOST, RoleType.ADMIN)
export class HostHomestaysController {
  constructor(private readonly homestaysService: HomestaysService) {}

  private getHostId(req: any): string {
    return String(req.user?.id || req.user?.sub || (req.headers['x-user-id'] as string) || '1');
  }

  // ==========================================
  // 0. THỐNG KÊ TỔNG QUAN DASHBOARD
  // ==========================================

  @Get('dashboard/stats')
  async getDashboardStats(@Req() req: any) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.getHostDashboardStats(hostId);
  }

  // ==========================================
  // 1. QUẢN LÝ HOMESTAYS CỦA CHỦ NHÀ
  // ==========================================

  @Get('homestays/my-listings')
  async getMyListings(@Req() req: any) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.findMyListings(hostId);
  }

  @Post('homestays')
  async createHomestay(@Req() req: any, @Body() dto: CreateHomestayDto) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.createHomestay(hostId, dto);
  }

  @Get('homestays/:id')
  async getHomestayDetail(@Req() req: any, @Param('id') id: string) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.findHostHomestay(hostId, id);
  }

  @Put('homestays/:id')
  async updateHomestay(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateHomestayDto,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.updateHomestay(hostId, id, dto);
  }

  @Delete('homestays/:id')
  async deleteHomestay(@Req() req: any, @Param('id') id: string) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.deleteHomestay(hostId, id);
  }

  // ==========================================
  // 2. QUẢN LÝ PHÒNG (ROOMS)
  // ==========================================

  @Post('homestays/:id/rooms')
  async createRoom(
    @Req() req: any,
    @Param('id') homestayId: string,
    @Body() dto: CreateRoomDto,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.createRoom(hostId, homestayId, dto);
  }

  @Put('rooms/:id')
  async updateRoom(
    @Req() req: any,
    @Param('id') roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.updateRoom(hostId, roomId, dto);
  }

  @Delete('rooms/:id')
  async deleteRoom(@Req() req: any, @Param('id') roomId: string) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.deleteRoom(hostId, roomId);
  }

  // ==========================================
  // 3. QUẢN LÝ ẢNH PHÒNG (ROOM IMAGES)
  // ==========================================

  @Post('rooms/:id/images')
  async addRoomImage(
    @Req() req: any,
    @Param('id') roomId: string,
    @Body() dto: UploadRoomImageDto,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.addRoomImage(hostId, roomId, dto);
  }

  @Post('rooms/:id/images/batch')
  async batchAddRoomImages(
    @Req() req: any,
    @Param('id') roomId: string,
    @Body('images') images: string[],
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.batchUploadRoomImages(hostId, roomId, images || []);
  }

  @Delete('rooms/images/:imageId')
  async deleteRoomImage(@Req() req: any, @Param('imageId') imageId: string) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.deleteRoomImage(hostId, imageId);
  }

  @Get('homestays/:id/photos-count')
  async getHomestayPhotosCount(@Param('id') id: string) {
    const count = await this.homestaysService.getHomestayTotalPhotoCount(id);
    return { count, max: 100, remaining: Math.max(0, 100 - count) };
  }

  // ==========================================
  // 4. LỊCH GIÁ & TÌNH TRẠNG PHÒNG TRỐNG
  // ==========================================

  @Get('rooms/:id/calendar')
  async getRoomCalendar(
    @Req() req: any,
    @Param('id') roomId: string,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.getRoomCalendar(hostId, roomId, fromDate, toDate);
  }

  @Put('rooms/:id/calendar')
  async updateRoomCalendar(
    @Req() req: any,
    @Param('id') roomId: string,
    @Body() dto: UpdateCalendarDto,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.updateRoomCalendar(hostId, roomId, dto);
  }

  @Put('rooms/:id/calendar/batch')
  async batchUpdateRoomCalendar(
    @Req() req: any,
    @Param('id') roomId: string,
    @Body() dto: BatchUpdateCalendarDto,
  ) {
    const hostId = this.getHostId(req);
    return await this.homestaysService.batchUpdateRoomCalendar(hostId, roomId, dto);
  }
}
