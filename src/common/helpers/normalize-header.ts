export const normalizeHeader = (value: unknown) => {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number') {
        return String(value);
    }

    if (Array.isArray(value)) {
        const firstString = value.find((item) => typeof item === 'string');
        return firstString;
    }

    return undefined;
};
