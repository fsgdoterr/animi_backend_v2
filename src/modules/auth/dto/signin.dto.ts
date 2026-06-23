import {
    IsString,
} from 'class-validator';

export class SigninDto {
    @IsString({ message: "Ім'я користувача має бути рядком." })
    username: string;

    @IsString({ message: 'Пароль має бути рядком.' })
    password: string;
}
