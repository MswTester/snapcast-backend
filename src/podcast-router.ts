import { Elysia, t } from 'elysia';
import { PrismaClient } from '@prisma/client';
import { PodcastService } from './podcast-service';
import { ApiSuccessResponseTypeBox, createSuccessResponse, commonErrorsTypebox, ApiErrorResponseTypeBox } from '@vinxen/shared/schema/ApiResponseTypebox';

export interface PodcastRouterOptions {
  requireAuth?: boolean;
  audioDirectory?: string;
  authFile?: string;
}

const DEFAULT_OPTIONS: PodcastRouterOptions = {
  requireAuth: true,
  audioDirectory: process.env.AUDIO_DIRECTORY || './audio',
  authFile: process.env.ELEVENLABS_AUTH_FILE || './auth.txt'
};

// Schemas
const GeneratePodcastSchema = t.Object({
  situation: t.String(),
  channelId: t.Number(),
  title: t.Optional(t.String())
});

const GenerateScriptSchema = t.Object({
  situation: t.String()
});

const PodcastScriptSchema = t.Object({
  title: t.String(),
  total_duration_seconds: t.Number(),
  segments: t.Array(t.Object({
    type: t.String(),
    speaker: t.String(),
    text: t.String(),
    start_time: t.Number()
  }))
});

const GenerationResultSchema = t.Object({
  success: t.Boolean(),
  snapId: t.Optional(t.Number()),
  script: t.Optional(PodcastScriptSchema),
  audioFile: t.Optional(t.String()),
  error: t.Optional(t.String())
});

export const podcastRouter = (
  prisma: PrismaClient,
  options: PodcastRouterOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const podcastService = new PodcastService(prisma, {
    audioDirectory: config.audioDirectory,
    authFile: config.authFile
  });

  return new Elysia({ name: 'podcast-router', prefix: '/podcast' })
    .decorate('prisma', prisma)
    
    // Generate complete podcast
    .post('/generate', async ({ body, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const { situation, channelId, title } = body as {
          situation: string;
          channelId: number;
          title?: string;
        };

        const result = await podcastService.generatePodcast(
          situation,
          channelId,
          user?.id || 1,
          title
        );

        set.status = result.success ? 201 : 500;
        return createSuccessResponse(result);
      } catch (error) {
        console.error('Podcast generation error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Podcast'],
        summary: 'Generate complete podcast',
        description: 'Generate a complete podcast with script and audio from a situation'
      },
      body: GeneratePodcastSchema,
      response: {
        201: ApiSuccessResponseTypeBox(GenerationResultSchema),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })

    // Generate script only
    .post('/script', async ({ body, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const { situation } = body as { situation: string };
        const script = await podcastService.generateScriptOnly(situation);

        if (script) {
          set.status = 200;
          return createSuccessResponse(script);
        } else {
          set.status = 500;
          return commonErrorsTypebox.internalError();
        }
      } catch (error) {
        console.error('Script generation error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Podcast'],
        summary: 'Generate script only',
        description: 'Generate podcast script without audio'
      },
      body: GenerateScriptSchema,
      response: {
        200: ApiSuccessResponseTypeBox(PodcastScriptSchema),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })

    // Get generation status
    .get('/status/:snapId', async ({ params, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.snapId);
        if (isNaN(snapId)) {
          set.status = 400;
          return commonErrorsTypebox.validationError('Invalid snap ID');
        }

        const status = await podcastService.getStatus(snapId);
        set.status = 200;
        return createSuccessResponse(status);
      } catch (error) {
        console.error('Status check error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Podcast'],
        summary: 'Get generation status',
        description: 'Check podcast generation status'
      },
      params: t.Object({
        snapId: t.String()
      }),
      response: {
        200: ApiSuccessResponseTypeBox(t.Object({
          status: t.String(),
          snap: t.Optional(t.Any()),
          audioExists: t.Optional(t.Boolean()),
          error: t.Optional(t.String())
        })),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};