import {
    IsEmail,
    IsString,
    Matches,
    MaxLength,
    MinLength,
} from 'class-validator';

export class SignupDto {
    @IsEmail({}, { message: 'Невалідна пошта.' })
    email: string;

    @IsString({ message: "Ім'я користувача має бути рядком." })
    @Matches(/^[a-zA-Z0-9_]+$/, {
        message:
            "Ім'я користувача може складатись тільки з букв, цифр або нижнього прочерку.",
    })
    @MinLength(4, {
        message: "Ім'я користувача має складатись мінімум з 4 символів",
    })
    @MaxLength(30, {
        message: "Ім'я користувача має складатись максимум з 30 символів",
    })
    username: string;

    @IsString({ message: 'Пароль має бути рядком.' })
    @MinLength(4, { message: 'Пароль має складатись мінімум з 6 символів' })
    @MaxLength(40, { message: 'Пароль має складатись максимум з 40 символів' })
    password: string;
}
