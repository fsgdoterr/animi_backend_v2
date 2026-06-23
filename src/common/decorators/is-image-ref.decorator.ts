import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    isURL,
} from 'class-validator';

export function IsImageRef(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isImageRef',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value === 'number') {
                        return Number.isInteger(value) && value > 0;
                    }

                    if (typeof value === 'string') {
                        return isURL(value, {
                            protocols: ['http', 'https'],
                            require_protocol: true,
                        });
                    }

                    return false;
                },

                defaultMessage(args: ValidationArguments) {
                    return `${args.property} має бути id зображення або url лінк на зображення.`;
                },
            },
        });
    };
}
