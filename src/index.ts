// src/index.ts
import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { PrismaClient } from '@prisma/client';
import { ApiSuccessResponseTypeBox, createSuccessResponse } from '@vinxen/shared/schema/ApiResponseTypebox';
import { auth } from "@vinxen/auth";
import { database } from '@vinxen/database';
import { gemini } from '@vinxen/gemini';
import { audioStream } from './audio-stream';
import { audioUpload } from './audio-upload';
import { aiSearch } from './ai-search';
import { recommendedSnaps } from './recommended-snaps';
import { snapDetail } from './snap-detail';

const prisma = new PrismaClient();

prisma.$connect().then(() => {
  console.log('Connected to database');
}).catch((e: Error) => {
  console.error('Failed to connect to database', e);
});

const PORT = process.env.PORT || 8000;

const app = new Elysia()
  .decorate('prisma', prisma)
  .use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [`http://localhost:${PORT}`],
    credentials: true,
  }))
  .use(swagger())
  .use(jwt({
    name: 'accessJwt',
    secret: process.env.JWT_SECRET || 'fallback-secret',
    exp: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  }))
  .use(jwt({
    name: 'refreshJwt',
    secret: process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret',
    exp: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  }))
  .derive(async ({ accessJwt, cookie: { accessToken } }) => {
    if (!accessToken?.value) {
      return { user: null };
    }
    
    try {
      const payload = await accessJwt.verify(accessToken.value) as any;
      if (!payload || payload.type !== "access") {
        return { user: null };
      }
      return {
        user: {
          id: payload.id,
          email: payload.email
        }
      };
    } catch {
      return { user: null };
    }
  })
  .use(auth(prisma))
  .use(database(prisma, {
    prefix: '/api',
    models: ['Channel', 'Snap', 'Context', 'SearchHistory'],
    requireAuth: true
  }))
  .use(gemini(prisma, {
    prefix: '/ai',
    requireAuth: true
  }))
  .use(audioStream(prisma, {
    audioDirectory: process.env.AUDIO_DIRECTORY || './audio',
    requireAuth: true,
    maxFileSize: 500 * 1024 * 1024 // 500MB
  }))
  .use(audioUpload(prisma, {
    audioDirectory: process.env.AUDIO_DIRECTORY || './audio',
    requireAuth: true,
    maxFileSize: 500 * 1024 * 1024 // 500MB
  }))
  .use(aiSearch(prisma, {
    requireAuth: false,
    maxResults: 20
  }))
  .use(recommendedSnaps(prisma, {
    requireAuth: false,
    maxLimit: 50,
    defaultLimit: 10
  }))
  .use(snapDetail(prisma, {
    requireAuth: false,
    maxRelatedLimit: 20,
    defaultRelatedLimit: 5
  }))

  // Public routes
  .get('/health', () => createSuccessResponse({ 
    status: 'ok'
  }), {
    detail: {
      tags: ['Health'],
      summary: 'Health check endpoint',
      description: 'Returns the health status of the API'
    },
    response: {
      200: ApiSuccessResponseTypeBox(t.Object({
        status: t.String()
      })),
    }
  })

  .listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Swagger UI accessible at http://localhost:${PORT}/swagger`);
  });

export default app;