import { ImageService } from '../../modules/image/image.service';

interface ImagePrismaObj {
    connect?: {
        id: number;
    };
    disconnect?: boolean;
}

export const prepareImage = async (params: {
    service: ImageService;
    image?: string | number | null;
}) => {
    let preparedImage: { id: number } | undefined;

    if (params.image && typeof params.image === 'string') {
        preparedImage = await params.service.createImage(params.image);
    } else if (params.image && typeof params.image === 'number') {
        preparedImage = { id: params.image };
    }

    let imagePrismaObj: ImagePrismaObj | undefined = undefined;
    if (preparedImage) {
        imagePrismaObj = { connect: { id: preparedImage.id } };
    } else if (params.image === null) {
        imagePrismaObj = { disconnect: true };
    }

    return { image: preparedImage, imagePrismaObj };
};
