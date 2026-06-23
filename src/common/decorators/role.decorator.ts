import { SetMetadata } from "@nestjs/common";
import { UserRole } from "../../generated/prisma/enums";

export const ROLE_KEY = "role";

export const Role = (role: UserRole) => {
    return SetMetadata(ROLE_KEY, role);
};