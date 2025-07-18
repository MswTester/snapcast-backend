import sharp from 'sharp';

export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxSizeKB?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

export interface ImageCompressionResult {
  base64: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  format: string;
  dimensions: {
    width: number;
    height: number;
  };
}

const DEFAULT_OPTIONS: Required<ImageCompressionOptions> = {
  maxWidth: 400,
  maxHeight: 400,
  quality: 80,
  maxSizeKB: 100,
  format: 'jpeg'
};

/**
 * Compress and resize base64 image
 */
export async function compressBase64Image(
  base64Image: string,
  options: ImageCompressionOptions = {}
): Promise<ImageCompressionResult> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  try {
    // Parse base64 data
    const { data: originalBuffer, mimeType } = parseBase64(base64Image);
    const originalSize = originalBuffer.length;
    
    // Get original image info
    const originalImage = sharp(originalBuffer);
    const originalMetadata = await originalImage.metadata();
    
    // Calculate compression parameters
    let currentQuality = config.quality;
    let currentBuffer = originalBuffer;
    let iterations = 0;
    const maxIterations = 10;
    
    while (iterations < maxIterations) {
      // Process image with current settings
      let processedImage = sharp(originalBuffer);
      
      // Resize if needed
      if (originalMetadata.width! > config.maxWidth || originalMetadata.height! > config.maxHeight) {
        processedImage = processedImage.resize(config.maxWidth, config.maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }
      
      // Convert format and compress
      switch (config.format) {
        case 'jpeg':
          processedImage = processedImage.jpeg({ quality: currentQuality });
          break;
        case 'png':
          processedImage = processedImage.png({ 
            compressionLevel: Math.round((100 - currentQuality) / 10) 
          });
          break;
        case 'webp':
          processedImage = processedImage.webp({ quality: currentQuality });
          break;
      }
      
      currentBuffer = await processedImage.toBuffer();
      const currentSizeKB = currentBuffer.length / 1024;
      
      // Check if size is acceptable
      if (currentSizeKB <= config.maxSizeKB || currentQuality <= 20) {
        break;
      }
      
      // Reduce quality for next iteration
      currentQuality = Math.max(20, currentQuality - 10);
      iterations++;
    }
    
    // Get final dimensions
    const finalMetadata = await sharp(currentBuffer).metadata();
    
    // Convert back to base64
    const finalBase64 = `data:image/${config.format};base64,${currentBuffer.toString('base64')}`;
    
    return {
      base64: finalBase64,
      originalSize,
      compressedSize: currentBuffer.length,
      compressionRatio: originalSize / currentBuffer.length,
      format: config.format,
      dimensions: {
        width: finalMetadata.width || 0,
        height: finalMetadata.height || 0
      }
    };
    
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`);
  }
}

/**
 * Validate if base64 string is a valid image
 */
export function validateImageBase64(base64Image: string): boolean {
  try {
    const { data, mimeType } = parseBase64(base64Image);
    
    // Check if it's a valid image MIME type
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validMimeTypes.includes(mimeType)) {
      return false;
    }
    
    // Check minimum size (should be at least 100 bytes for a valid image)
    if (data.length < 100) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Get base64 image size in KB
 */
export function getBase64ImageSize(base64Image: string): number {
  try {
    const { data } = parseBase64(base64Image);
    return data.length / 1024;
  } catch {
    return 0;
  }
}

/**
 * Check if image needs compression
 */
export function shouldCompressImage(
  base64Image: string,
  maxSizeKB: number = 100
): boolean {
  const sizeKB = getBase64ImageSize(base64Image);
  return sizeKB > maxSizeKB;
}

/**
 * Parse base64 image data
 */
function parseBase64(base64Image: string): { data: Buffer; mimeType: string } {
  // Check if it's a data URL
  if (base64Image.startsWith('data:')) {
    const matches = base64Image.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data URL format');
    }
    
    const mimeType = matches[1];
    const base64Data = matches[2];
    const data = Buffer.from(base64Data, 'base64');
    
    return { data, mimeType };
  } else {
    // Assume it's just base64 data without data URL prefix
    const data = Buffer.from(base64Image, 'base64');
    
    // Try to detect format from buffer
    const mimeType = detectMimeType(data);
    
    return { data, mimeType };
  }
}

/**
 * Detect MIME type from buffer
 */
function detectMimeType(buffer: Buffer): string {
  // Check for common image signatures
  if (buffer.length >= 4) {
    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    
    // WebP
    if (buffer.length >= 12 && 
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'image/webp';
    }
    
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }
  }
  
  // Default to JPEG if we can't detect
  return 'image/jpeg';
}

/**
 * Compress avatar image with predefined settings
 */
export async function compressAvatarImage(base64Image: string): Promise<string> {
  const result = await compressBase64Image(base64Image, {
    maxWidth: 200,
    maxHeight: 200,
    quality: 85,
    maxSizeKB: 50, // 50KB limit for avatars
    format: 'jpeg'
  });
  
  return result.base64;
}

/**
 * Compress channel image with predefined settings
 */
export async function compressChannelImage(base64Image: string): Promise<string> {
  const result = await compressBase64Image(base64Image, {
    maxWidth: 400,
    maxHeight: 400,
    quality: 80,
    maxSizeKB: 100, // 100KB limit for channel images
    format: 'jpeg'
  });
  
  return result.base64;
}