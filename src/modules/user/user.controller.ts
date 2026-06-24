import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    ParseIntPipe,
    Res,
    Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { instanceToPlain } from 'class-transformer';
import { UserEntity } from '../../common/entities/user.entity';
import { adminGuards } from '../../common/helpers/admin.accept';
import { UserRole } from '../../generated/prisma/enums';
import { Role } from '../../common/decorators/role.decorator';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';
import { type Response } from 'express';
import { UserFiltersDto } from './dto/user-filters.dto';

@Controller('user')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post()
    async create(@Body() createUserDto: CreateUserDto) {
        const user = await this.userService.create(createUserDto);

        return instanceToPlain(new UserEntity(user), {
            groups: ['private'],
        });
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: UserFiltersDto,
    ) {
        const result = await this.userService.findAll(filters);

        setPaginationHeaders(res, result);

        return result.items.map((g) =>
            instanceToPlain(new UserEntity(g), {
                groups: ['private'],
            }),
        );
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const user = await this.userService.findOne(id);

        return instanceToPlain(new UserEntity(user), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateUserDto: UpdateUserDto,
    ) {
        const user = await this.userService.update(id, updateUserDto);

        return instanceToPlain(new UserEntity(user), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        return await this.userService.remove(id);
    }

    @Get('check-email/:email')
    async checkEmail(@Param('email') email: string) {
        const check = await this.userService.checkUser({ email });

        return { check };
    }

    @Get('check-username/:username')
    async checkUsername(@Param('username') username: string) {
        const check = await this.userService.checkUser({ username });

        return { check };
    }
}
