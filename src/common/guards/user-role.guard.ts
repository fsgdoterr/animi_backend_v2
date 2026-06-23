import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserEntity } from '../entities/user.entity';
import { UserRole } from '../../generated/prisma/enums';
import { ROLE_KEY } from '../decorators/role.decorator';

@Injectable()
export class UserRoleGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRole = this.reflector.getAllAndOverride<UserRole>(
            ROLE_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (!requiredRole) {
            return true;
        }

        const request = context.switchToHttp().getRequest();

        const user = request.user as
            | undefined
            | InstanceType<typeof UserEntity>;

        if (!user) throw new ForbiddenException('У вас недостатньо прав.');

        const roles: UserRole[] =
            requiredRole === UserRole.MODER
                ? [UserRole.MODER, UserRole.ADMIN, UserRole.SUPER_ADMIN]
                : requiredRole === UserRole.ADMIN
                  ? [UserRole.ADMIN, UserRole.SUPER_ADMIN]
                  : requiredRole === UserRole.SUPER_ADMIN
                    ? [UserRole.SUPER_ADMIN]
                    : [];

        if (!roles.includes(user.role))
            throw new ForbiddenException('Не достатньо прав.');

        return true;
    }
}
