import { Elysia, t } from 'elysia';
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { ApiErrorResponseTypeBox, ApiSuccessResponseTypeBox, createSuccessResponse, commonErrorsTypebox } from '@vinxen/shared/schema/ApiResponseTypebox';

export interface AudioUploadOptions {
  audioDirectory?: string;
  requireAuth?: boolean;
  maxFileSize?: number; // in bytes
  allowedExtensions?: string[];
}

const DEFAULT_OPTIONS: AudioUploadOptions = {
  audioDirectory: process.env.AUDIO_DIRECTORY || './audio',
  requireAuth: true,
  maxFileSize: 500 * 1024 * 1024, // 500MB
  allowedExtensions: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus']
};

export const audioUpload = (
  prisma: PrismaClient,
  options: AudioUploadOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Ensure audio directory exists
  if (!existsSync(config.audioDirectory!)) {
    mkdirSync(config.audioDirectory!, { recursive: true });
  }

  return new Elysia({ name: 'audio-upload', prefix: '/upload' })
    .decorate('prisma', prisma)
    .post('/audio/:snapId', async ({ params, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      // Authentication check
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.snapId);
        
        // Get snap and verify ownership
        const snap = await prisma.snap.findUnique({
          where: { id: snapId },
          include: {
            channel: {
              include: {
                author: {
                  select: { id: true }
                }
              }
            }
          }
        });

        if (!snap) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        // Check if user owns the snap
        if (config.requireAuth && user && snap.channel.author.id !== user.id) {
          set.status = 403;
          return commonErrorsTypebox.forbidden();
        }

        const { file, filename } = body;
        
        if (!file || !filename) {
          set.status = 400;
          return commonErrorsTypebox.validationError('File and filename are required');
        }

        // Check file size
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        if (config.maxFileSize && fileBuffer.length > config.maxFileSize) {
          set.status = 413;
          return commonErrorsTypebox.internalError();
        }

        // Check file extension
        const ext = extname(filename).toLowerCase();
        if (config.allowedExtensions && !config.allowedExtensions.includes(ext)) {
          set.status = 400;
          return commonErrorsTypebox.validationError(`Unsupported file type. Allowed: ${config.allowedExtensions.join(', ')}`);
        }

        // Generate unique filename
        const timestamp = Date.now();
        const uniqueFilename = `${snapId}_${timestamp}${ext}`;
        const filePath = join(config.audioDirectory!, uniqueFilename);

        // Save file
        writeFileSync(filePath, fileBuffer);

        // Update snap record with audio file path
        const updatedSnap = await prisma.snap.update({
          where: { id: snapId },
          data: {
            audio: uniqueFilename
          }
        });

        set.status = 200;
        return createSuccessResponse({
          snapId: updatedSnap.id,
          filename: uniqueFilename,
          size: fileBuffer.length,
          uploadedAt: new Date().toISOString(),
          streamUrl: `/audio/snap/${snapId}`
        });
      } catch (error) {
        console.error('Audio upload error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      params: t.Object({
        snapId: t.String()
      }),
      body: t.Object({
        file: t.File(),
        filename: t.String()
      }),
      detail: {
        tags: ['Audio'],
        summary: 'Upload audio file',
        description: 'Upload audio file for a podcast episode (Snap). Only the channel owner can upload audio files.'
      },
      response: {
        200: ApiSuccessResponseTypeBox(t.Object({
          snapId: t.Number(),
          filename: t.String(),
          size: t.Number(),
          uploadedAt: t.String(),
          streamUrl: t.String()
        })),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        413: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })
    .post('/external/:snapId', async ({ params, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      // Authentication check (for TTS server or external services)
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.snapId);
        const { audioData, filename, duration } = body;
        
        // Get snap and verify ownership
        const snap = await prisma.snap.findUnique({
          where: { id: snapId },
          include: {
            channel: {
              include: {
                author: {
                  select: { id: true }
                }
              }
            }
          }
        });

        if (!snap) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        // For external services, allow if user owns the snap or is admin
        if (config.requireAuth && user && snap.channel.author.id !== user.id) {
          set.status = 403;
          return commonErrorsTypebox.forbidden();
        }

        // Decode base64 audio data
        const fileBuffer = Buffer.from(audioData, 'base64');
        
        // Check file size
        if (config.maxFileSize && fileBuffer.length > config.maxFileSize) {
          set.status = 413;
          return commonErrorsTypebox.internalError();
        }

        // Generate unique filename
        const timestamp = Date.now();
        const ext = extname(filename).toLowerCase() || '.mp3';
        const uniqueFilename = `${snapId}_${timestamp}${ext}`;
        const filePath = join(config.audioDirectory!, uniqueFilename);

        // Save file
        writeFileSync(filePath, fileBuffer);

        // Update snap record with audio file path and duration
        const updatedSnap = await prisma.snap.update({
          where: { id: snapId },
          data: {
            audio: uniqueFilename,
            duration: duration || snap.duration
          }
        });

        set.status = 200;
        return createSuccessResponse({
          snapId: updatedSnap.id,
          filename: uniqueFilename,
          size: fileBuffer.length,
          duration: updatedSnap.duration,
          uploadedAt: new Date().toISOString(),
          streamUrl: `/audio/snap/${snapId}`
        });
      } catch (error) {
        console.error('External audio upload error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      params: t.Object({
        snapId: t.String()
      }),
      body: t.Object({
        audioData: t.String(), // base64 encoded audio
        filename: t.String(),
        duration: t.Optional(t.Number())
      }),
      detail: {
        tags: ['Audio'],
        summary: 'Upload audio from external service',
        description: 'Upload audio file from external service (like TTS server) using base64 encoded data'
      },
      response: {
        200: ApiSuccessResponseTypeBox(t.Object({
          snapId: t.Number(),
          filename: t.String(),
          size: t.Number(),
          duration: t.Number(),
          uploadedAt: t.String(),
          streamUrl: t.String()
        })),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        413: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};