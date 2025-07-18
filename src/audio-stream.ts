import { Elysia, t } from 'elysia';
import { PrismaClient } from '@prisma/client';
import { existsSync, statSync, createReadStream } from 'fs';
import { join, extname } from 'path';
import { ApiErrorResponseTypeBox, commonErrorsTypebox } from '@vinxen/shared/schema/ApiResponseTypebox';

export interface AudioStreamOptions {
  audioDirectory?: string;
  requireAuth?: boolean;
  maxFileSize?: number; // in bytes
}

const DEFAULT_OPTIONS: AudioStreamOptions = {
  audioDirectory: process.env.AUDIO_DIRECTORY || './audio',
  requireAuth: true,
  maxFileSize: 500 * 1024 * 1024 // 500MB
};

// Audio MIME types
const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus'
};

export const audioStream = (
  prisma: PrismaClient,
  options: AudioStreamOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return new Elysia({ name: 'audio-stream', prefix: '/audio' })
    .decorate('prisma', prisma)
    .get('/snap/:id', async ({ params, request, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      // Authentication check
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.id);
        
        // Get snap from database
        const snap = await prisma.snap.findUnique({
          where: { id: snapId },
          include: {
            channel: {
              include: {
                author: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        });

        if (!snap) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        // Check if user has access (channel owner or subscriber)
        if (config.requireAuth && user) {
          const isOwner = snap.channel.author.id === user.id;
          const isSubscriber = user.planId !== null; // Basic subscription check
          
          if (!isOwner && !isSubscriber) {
            set.status = 403;
            return commonErrorsTypebox.forbidden();
          }
        }

        // Construct file path
        const audioPath = join(config.audioDirectory!, snap.audio);
        
        // Check if file exists
        if (!existsSync(audioPath)) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        // Get file stats
        const stats = statSync(audioPath);
        const fileSize = stats.size;
        
        // Check file size limit
        if (config.maxFileSize && fileSize > config.maxFileSize) {
          set.status = 413;
          return commonErrorsTypebox.internalError();
        }

        // Get file extension and MIME type
        const ext = extname(audioPath).toLowerCase();
        const mimeType = AUDIO_MIME_TYPES[ext] || 'application/octet-stream';

        // Parse range header for seeking support
        const range = request.headers.get('range');
        
        if (range) {
          // Handle range request
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0] || '0', 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;

          if (start >= fileSize || end >= fileSize) {
            set.status = 416;
            set.headers['Content-Range'] = `bytes */${fileSize}`;
            return commonErrorsTypebox.internalError();
          }

          // Set partial content headers
          set.status = 206;
          const rangeHeaders = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Content-Type': mimeType,
            'Cache-Control': 'no-cache'
          };
          set.headers = rangeHeaders;

          // Create readable stream for the range
          const stream = createReadStream(audioPath, { start, end });
          
          return new Response(stream as any, {
            status: 206,
            headers: rangeHeaders
          });
        } else {
          // Handle full file request
          set.status = 200;
          const fullHeaders = {
            'Content-Length': fileSize.toString(),
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600' // 1 hour cache
          };
          set.headers = fullHeaders;

          // Create readable stream for the entire file
          const stream = createReadStream(audioPath);
          
          return new Response(stream as any, {
            status: 200,
            headers: fullHeaders
          });
        }
      } catch (error) {
        console.error('Audio streaming error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      params: t.Object({
        id: t.String()
      }),
      detail: {
        tags: ['Audio'],
        summary: 'Stream audio file',
        description: 'Stream audio file for a podcast episode (Snap) with range request support for seeking. Requires authentication and proper access permissions.'
      },
      response: {
        // 200: t.Any(), // Audio stream
        // 206: t.Any(), // Partial content
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        413: ApiErrorResponseTypeBox,
        416: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })
    .get('/snap/:id/info', async ({ params, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.id);
        
        const snap = await prisma.snap.findUnique({
          where: { id: snapId },
          include: {
            channel: {
              include: {
                author: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        });

        if (!snap) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        // Check access permissions
        if (config.requireAuth && user) {
          const isOwner = snap.channel.author.id === user.id;
          const isSubscriber = user.planId !== null;
          
          if (!isOwner && !isSubscriber) {
            set.status = 403;
            return commonErrorsTypebox.forbidden();
          }
        }

        // Get audio file info
        const audioPath = join(config.audioDirectory!, snap.audio);
        
        if (!existsSync(audioPath)) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        const stats = statSync(audioPath);
        const ext = extname(audioPath).toLowerCase();
        const mimeType = AUDIO_MIME_TYPES[ext] || 'application/octet-stream';

        return {
          id: snap.id,
          title: snap.title,
          duration: snap.duration,
          views: snap.views,
          channel: {
            id: snap.channel.id,
            name: snap.channel.name,
            author: snap.channel.author.name
          },
          audio: {
            filename: snap.audio,
            size: stats.size,
            mimeType: mimeType,
            lastModified: stats.mtime.toISOString()
          },
          streamUrl: `/audio/snap/${snap.id}`
        };
      } catch (error) {
        console.error('Audio info error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      params: t.Object({
        id: t.String()
      }),
      detail: {
        tags: ['Audio'],
        summary: 'Get audio file information',
        description: 'Get metadata and information about an audio file for a podcast episode'
      },
      response: {
        200: t.Object({
          id: t.Number(),
          title: t.String(),
          duration: t.Number(),
          views: t.Number(),
          channel: t.Object({
            id: t.Number(),
            name: t.String(),
            author: t.String()
          }),
          audio: t.Object({
            filename: t.String(),
            size: t.Number(),
            mimeType: t.String(),
            lastModified: t.String()
          }),
          streamUrl: t.String()
        }),
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};