import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../../modules/auth/auth.service';

@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
    constructor(private readonly authService: AuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const user = await this.authService.getCurrentUser(request);

        if (user) {
            (request as unknown as { user?: typeof user }).user = user;
        }

        return true;
    }
}
