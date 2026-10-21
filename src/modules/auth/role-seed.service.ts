import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role, RoleType } from '../users/entities/role.entity.js';

const DEFAULT_ROLES: Record<RoleType, string> = {
  [RoleType.CUSTOMER]: 'Khách hàng tìm kiếm, đặt phòng và đánh giá',
  [RoleType.HOST]: 'Chủ nhà quản lý homestay',
  [RoleType.ADMIN]: 'Quản trị hệ thống',
};

/** Tạo sẵn các vai trò mặc định khi khởi động (idempotent) */
@Injectable()
export class RoleSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleSeedService.name);

  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const names = Object.keys(DEFAULT_ROLES) as RoleType[];
    const existing = await this.roleRepo.find({ where: { name: In(names) } });
    const missing = names.filter((n) => !existing.some((r) => r.name === n));
    if (missing.length === 0) {
      return;
    }

    await this.roleRepo.save(
      missing.map((name) =>
        this.roleRepo.create({ name, description: DEFAULT_ROLES[name] }),
      ),
    );
    this.logger.log(`Đã tạo vai trò: ${missing.join(', ')}`);
  }
}
