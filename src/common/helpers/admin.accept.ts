import { UserRole } from '../../generated/prisma/enums';
import { SessionAuthGuard } from '../guards/session-auth.guard';
import { UserRoleGuard } from '../guards/user-role.guard';

export const adminGuards = [SessionAuthGuard, UserRoleGuard];
export const adminRole = UserRole.ADMIN;
