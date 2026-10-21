import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../guards/roles.guard.js';

/**
 * Khai báo các vai trò được phép gọi route, dùng cùng RolesGuard.
 * Ví dụ: @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
