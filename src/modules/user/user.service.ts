import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { UserPermissions } from '../../generated/prisma/enums';
import { UserSelect } from '../../common/orm/user.orm';
import { UserFiltersDto } from './dto/user-filters.dto';
import { Prisma } from '../../generated/prisma/client';
import { paginateById } from '../../common/pagination';

@Injectable()
export class UserService {
    constructor(private readonly prisma: PrismaService) {}
    async create({
        email,
        username,
        password,
        displayName,
        avatar,
        permissions,
        role,
    }: CreateUserDto) {
        const existing = await this.prisma.user.findFirst({
            where: { OR: [{ email }, { username }] },
        });

        if (existing && existing.username === username)
            throw new BadRequestException(
                "Користувач з таким ім'ям вже існує.",
            );
        if (existing && existing.email === email)
            throw new BadRequestException(
                'Користувач з такою поштою вже існує.',
            );

        const hashPassword = await bcrypt.hash(password, 12);

        const newUser = await this.prisma.user.create({
            data: {
                email,
                username,
                password: hashPassword,
                displayName,
                permissions: permissions as UserPermissions[],
                role,
                avatar: avatar
                    ? {
                          connect: {
                              id: avatar,
                          },
                      }
                    : undefined,
            },
            select: UserSelect,
        });

        return newUser;
    }

    async findAll(filters: UserFiltersDto) {
        const where: Prisma.UserWhereInput = {};

        if (filters.search) {
            where.OR = [
                { username: { contains: filters.search, mode: 'insensitive' } },
                { email: { contains: filters.search, mode: 'insensitive' } },
                {
                    displayName: {
                        contains: filters.search,
                        mode: 'insensitive',
                    },
                },
            ];
        }

        return paginateById({
            model: this.prisma.user,
            pagination: filters,
            where,
            orderBy: [{ id: 'desc' }],
            select: UserSelect,
        });
    }

    async findOne(id: number) {
        const user = await this.prisma.user.findFirst({
            where: { id },
            select: UserSelect,
        });

        if (!user)
            throw new NotFoundException('Не існує користувача з таким айді.');

        return user;
    }

    async update(
        id: number,
        {
            email,
            username,
            password,
            displayName,
            avatar,
            permissions,
            role,
        }: UpdateUserDto,
    ) {
        const existing = await this.prisma.user.findFirst({ where: { id } });
        if (!existing)
            throw new NotFoundException('Не існує користувача з таким айді.');

        const existingCred = await this.checkUser({ email, username });
        if (existingCred)
            throw new NotFoundException(
                "Користувач з такою поштою або ім'ям вже існує.",
            );

        let hashPassword;
        if (password) {
            hashPassword = await bcrypt.hash(password, 12);
        }

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                email,
                username,
                displayName,
                password: hashPassword,
                avatar: avatar
                    ? {
                          connect: { id: avatar },
                      }
                    : avatar === null
                      ? { disconnect: true }
                      : undefined,
                permissions,
                role,
            },
            select: UserSelect,
        });

        return updated;
    }

    async remove(id: number) {
        const existing = await this.prisma.user.findFirst({
            where: { id },
            select: UserSelect,
        });
        if (!existing)
            throw new NotFoundException('Не існує користувача з таким айді.');

        await this.prisma.user.delete({ where: { id } });
        return;
    }

    async checkUser({
        email,
        username,
    }: {
        email?: string;
        username?: string;
    }) {
        let user;
        if (email && username) {
            user = await this.prisma.user.findFirst({
                where: { OR: [{ email }, { username }] },
            });
        } else if (email) {
            user = await this.prisma.user.findFirst({ where: { email } });
        } else if (username) {
            user = await this.prisma.user.findFirst({ where: { username } });
        }

        return !!user;
    }
}
