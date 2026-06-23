import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import * as bcrypt from 'bcrypt';
import { generateSessionToken } from '../../common/helpers/session';
import { UserSelect } from '../../common/orm/user.orm';
import { SigninDto } from './dto/signin.dto';
import { type Request } from 'express';

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService) {}

    async signup({ email, username, password }: SignupDto) {
        const existingUser = await this.prisma.user.findFirst({
            where: { OR: [{ email }, { username }] },
        });

        if (existingUser)
            throw new BadRequestException(
                "Користувач з таким ім'ям або поштою вже існує",
            );

        const hashPassword = await bcrypt.hash(password, 12);

        const newUser = await this.prisma.user.create({
            data: {
                email,
                username,
                password: hashPassword,
            },
            select: UserSelect,
        });

        const { token, expiresAt } = await this.createSession(newUser.id);

        return {
            user: newUser,
            token,
            expiresAt,
        };
    }

    async signin({ username, password }: SigninDto) {
        const existingUser = await this.prisma.user.findFirst({
            where: { OR: [{ username }, { email: username }] },
        });

        if (!existingUser)
            throw new BadRequestException(
                "Невірне ім'я користувача або пароль.",
            );

        const isEqual = await bcrypt.compare(password, existingUser.password);

        if (!isEqual)
            throw new BadRequestException(
                "Невірне ім'я користувача або пароль.",
            );

        const user = await this.prisma.user.findFirst({
            where: { id: existingUser.id },
            select: UserSelect,
        });
        if (!user) throw new InternalServerErrorException();

        const { token, expiresAt } = await this.createSession(user.id);

        return {
            user,
            token,
            expiresAt,
        };
    }

    async logout(token: string) {
        await this.prisma.session.deleteMany({
            where: { hash: token },
        });

        return;
    }

    async getCurrentUser(req: Request) {
        const userSession = req.cookies['userSession'];
        if (!userSession) return null;

        const session = await this.prisma.session.findUnique({
            where: { hash: userSession },
            include: {
                user: {
                    select: UserSelect,
                },
            },
        });

        if (!session) return null;

        if (session.expiresAt.getTime() <= Date.now()) {
            await this.prisma.session.delete({
                where: { id: session.id },
            });
            return null;
        }

        return session.user;
    }

    private async createSession(userId: number) {
        const { token, expiresAt } = await generateSessionToken(userId);

        const newSession = await this.prisma.session.create({
            data: {
                user: { connect: { id: userId } },
                hash: token,
                expiresAt,
            },
        });

        return { token, expiresAt };
    }
}
