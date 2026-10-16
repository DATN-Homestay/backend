import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.roles) {
      throw new ForbiddenException('Bạn không có quyền truy cập tài nguyên này');
    }

    const hasRole = user.roles.some((role: any) =>
      requiredRoles.includes(role.name || role),
    );

    if (!hasRole) {
      throw new ForbiddenException('Tài khoản không đủ quyền thực hiện thao tác');
    }

    return true;
  }
}
