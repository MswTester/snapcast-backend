import { 
  compressAvatarImage, 
  compressChannelImage,
  validateImageBase64, 
  shouldCompressImage,
  getBase64ImageSize 
} from '@vinxen/shared';

export interface ImageCompressionMiddleware {
  beforeCreate?: (data: any) => Promise<any>;
  beforeUpdate?: (data: any) => Promise<any>;
}

/**
 * Middleware to handle image compression for User model
 */
export const userImageMiddleware: ImageCompressionMiddleware = {
  beforeCreate: async (data: any) => {
    if (data.avatar) {
      return await processUserAvatar(data);
    }
    return data;
  },
  beforeUpdate: async (data: any) => {
    if (data.avatar) {
      return await processUserAvatar(data);
    }
    return data;
  }
};

/**
 * Middleware to handle image compression for Channel model
 */
export const channelImageMiddleware: ImageCompressionMiddleware = {
  beforeCreate: async (data: any) => {
    if (data.avatar) {
      return await processChannelAvatar(data);
    }
    return data;
  },
  beforeUpdate: async (data: any) => {
    if (data.avatar) {
      return await processChannelAvatar(data);
    }
    return data;
  }
};

async function processUserAvatar(data: any): Promise<any> {
  const { avatar } = data;
  
  // Validate avatar image
  if (!validateImageBase64(avatar)) {
    throw new Error('Valid avatar image is required');
  }

  // Check avatar size before compression
  const originalSizeKB = getBase64ImageSize(avatar);
  if (originalSizeKB > 5000) { // 5MB limit
    throw new Error('Avatar image size cannot exceed 5MB');
  }

  // Compress avatar if needed
  let processedAvatar = avatar;
  try {
    if (shouldCompressImage(avatar, 50)) {
      console.log(`🖼️  Compressing user avatar: ${originalSizeKB.toFixed(2)}KB`);
      processedAvatar = await compressAvatarImage(avatar);
      const compressedSizeKB = getBase64ImageSize(processedAvatar);
      console.log(`✅ User avatar compressed: ${compressedSizeKB.toFixed(2)}KB`);
    }
  } catch (error) {
    console.error('User avatar compression failed:', error);
    throw new Error('Failed to process avatar image');
  }

  return {
    ...data,
    avatar: processedAvatar
  };
}

async function processChannelAvatar(data: any): Promise<any> {
  const { avatar } = data;
  
  // Validate avatar image
  if (!validateImageBase64(avatar)) {
    throw new Error('Valid channel avatar image is required');
  }

  // Check avatar size before compression
  const originalSizeKB = getBase64ImageSize(avatar);
  if (originalSizeKB > 5000) { // 5MB limit
    throw new Error('Channel avatar image size cannot exceed 5MB');
  }

  // Compress avatar if needed
  let processedAvatar = avatar;
  try {
    if (shouldCompressImage(avatar, 100)) {
      console.log(`🖼️  Compressing channel avatar: ${originalSizeKB.toFixed(2)}KB`);
      processedAvatar = await compressChannelImage(avatar);
      const compressedSizeKB = getBase64ImageSize(processedAvatar);
      console.log(`✅ Channel avatar compressed: ${compressedSizeKB.toFixed(2)}KB`);
    }
  } catch (error) {
    console.error('Channel avatar compression failed:', error);
    throw new Error('Failed to process channel avatar image');
  }

  return {
    ...data,
    avatar: processedAvatar
  };
}

/**
 * Get image middleware for a specific model
 */
export function getImageMiddleware(modelName: string): ImageCompressionMiddleware | null {
  switch (modelName.toLowerCase()) {
    case 'user':
      return userImageMiddleware;
    case 'channel':
      return channelImageMiddleware;
    default:
      return null;
  }
}