import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Res,
    UseGuards,
    HttpCode,
    HttpStatus,
    Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { type Response } from 'express';
import { instanceToPlain } from 'class-transformer';
import { UserEntity } from '../../common/entities/user.entity';
import { SigninDto } from './dto/signin.dto';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../../common/decorators/user.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('signup')
    @HttpCode(HttpStatus.OK)
    async signup(
        @Body() dto: SignupDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const { user, token, expiresAt } = await this.authService.signup(dto);

        res.cookie('userSession', token, {
            httpOnly: true,
            maxAge: expiresAt.getTime() - Date.now(),
        });

        return instanceToPlain(new UserEntity(user), {
            groups: ['me'],
        });
    }

    @Post('signin')
    @HttpCode(HttpStatus.OK)
    async signin(
        @Body() dto: SigninDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const { user, token, expiresAt } = await this.authService.signin(dto);

        res.cookie('userSession', token, {
            httpOnly: true,
            maxAge: expiresAt.getTime() - Date.now(),
        });

        return instanceToPlain(new UserEntity(user), {
            groups: ['me'],
        });
    }

    @Get('me')
    @UseGuards(SessionAuthGuard)
    async me(
        @User() user,
    ) {
        return instanceToPlain(new UserEntity(user), {
            groups: ["me"],
        });
    }

    @Get('logout')
    @HttpCode(HttpStatus.OK)
    @UseGuards(SessionAuthGuard)
    async logout(
        @Req() req,
        @Res({ passthrough: true }) res: Response,
    ) {
        await this.authService.logout(req.cookies.userSession);
        res.clearCookie('userSession');
        return;
    }
}
