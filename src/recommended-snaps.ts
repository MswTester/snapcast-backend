import { Elysia, t } from 'elysia';
import { PrismaClient } from '@prisma/client';
import { ApiSuccessResponseTypeBox, createSuccessResponse, commonErrorsTypebox, ApiErrorResponseTypeBox } from '@vinxen/shared/schema/ApiResponseTypebox';

export interface RecommendedSnapsOptions {
  requireAuth?: boolean;
  maxLimit?: number;
  defaultLimit?: number;
}

const DEFAULT_OPTIONS: RecommendedSnapsOptions = {
  requireAuth: false,
  maxLimit: 50,
  defaultLimit: 10
};

// Response schemas
const RecommendedSnapsResponseSchema = t.Object({
  snapIds: t.Array(t.Number()),
  total: t.Number(),
  hasMore: t.Boolean(),
  nextCursor: t.Optional(t.String())
});

const RecommendedSnapsQuerySchema = t.Object({
  limit: t.Optional(t.String()),
  exclude: t.Optional(t.String()),
  cursor: t.Optional(t.String()),
  tags: t.Optional(t.String()),
  minViews: t.Optional(t.String()),
  maxAge: t.Optional(t.String())
});

const ChannelRecommendedQuerySchema = t.Object({
  limit: t.Optional(t.String()),
  exclude: t.Optional(t.String()),
  cursor: t.Optional(t.String())
});

export const recommendedSnaps = (
  prisma: PrismaClient,
  options: RecommendedSnapsOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return new Elysia({ name: 'recommended-snaps', prefix: '/recommended' })
    .decorate('prisma', prisma)
    
    // GET /recommended/popular - Popular snaps by views
    .get('/popular', async ({ query, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const limit = Math.min(
          parseInt(query.limit || config.defaultLimit!.toString()),
          config.maxLimit!
        );
        
        const excludeIds = query.exclude 
          ? query.exclude.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
          : [];

        const offset = query.cursor 
          ? parseInt(Buffer.from(query.cursor, 'base64').toString()) 
          : 0;

        // Build where clause
        const whereClause: any = {};
        
        if (excludeIds.length > 0) {
          whereClause.id = { notIn: excludeIds };
        }

        if (query.minViews) {
          whereClause.views = { gte: parseInt(query.minViews) };
        }

        if (query.maxAge) {
          const maxAgeDate = new Date();
          maxAgeDate.setDate(maxAgeDate.getDate() - parseInt(query.maxAge));
          whereClause.createdAt = { gte: maxAgeDate };
        }

        if (query.tags) {
          const tagNames = query.tags.split(',').map(tag => tag.trim());
          whereClause.tags = {
            some: {
              name: { in: tagNames }
            }
          };
        }

        // Get total count
        const total = await prisma.snap.count({ where: whereClause });

        // Get snaps ordered by popularity (views desc, then by id desc for consistency)
        const snaps = await prisma.snap.findMany({
          where: whereClause,
          select: { id: true },
          orderBy: [
            { views: 'desc' },
            { id: 'desc' }
          ],
          skip: offset,
          take: limit
        });

        const snapIds = snaps.map(snap => snap.id);
        const hasMore = offset + limit < total;
        const nextCursor = hasMore 
          ? Buffer.from((offset + limit).toString()).toString('base64')
          : undefined;

        set.status = 200;
        return createSuccessResponse({
          snapIds,
          total,
          hasMore,
          nextCursor
        });

      } catch (error) {
        console.error('Popular snaps error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Recommendations'],
        summary: 'Get popular snaps by views',
        description: 'Get recommended snaps ordered by popularity with duplicate prevention'
      },
      query: RecommendedSnapsQuerySchema,
      response: {
        200: ApiSuccessResponseTypeBox(RecommendedSnapsResponseSchema),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })

    // GET /recommended/trending - Trending snaps (views + recency)
    .get('/trending', async ({ query, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const limit = Math.min(
          parseInt(query.limit || config.defaultLimit!.toString()),
          config.maxLimit!
        );
        
        const excludeIds = query.exclude 
          ? query.exclude.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
          : [];

        const offset = query.cursor 
          ? parseInt(Buffer.from(query.cursor, 'base64').toString()) 
          : 0;

        // Trending: For now, since we don't have createdAt, use view-based trending
        // TODO: Add createdAt field to Snap model for proper trending
        const whereClause: any = {};
        
        if (excludeIds.length > 0) {
          whereClause.id = { notIn: excludeIds };
        }

        if (query.minViews) {
          whereClause.views = { gte: parseInt(query.minViews) };
        }

        if (query.tags) {
          const tagNames = query.tags.split(',').map(tag => tag.trim());
          whereClause.tags = {
            some: {
              name: { in: tagNames }
            }
          };
        }

        const total = await prisma.snap.count({ where: whereClause });

        // For trending, we prioritize high-view snaps (since no createdAt field)
        const snaps = await prisma.snap.findMany({
          where: whereClause,
          select: { id: true },
          orderBy: [
            { views: 'desc' },
            { id: 'desc' }
          ],
          skip: offset,
          take: limit
        });

        const snapIds = snaps.map(snap => snap.id);
        const hasMore = offset + limit < total;
        const nextCursor = hasMore 
          ? Buffer.from((offset + limit).toString()).toString('base64')
          : undefined;

        set.status = 200;
        return createSuccessResponse({
          snapIds,
          total,
          hasMore,
          nextCursor
        });

      } catch (error) {
        console.error('Trending snaps error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Recommendations'],
        summary: 'Get trending snaps',
        description: 'Get recommended snaps that are trending (recent with good views)'
      },
      query: RecommendedSnapsQuerySchema,
      response: {
        200: ApiSuccessResponseTypeBox(RecommendedSnapsResponseSchema),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })

    // GET /recommended/by-channel/:channelId - Popular snaps from specific channel
    .get('/by-channel/:channelId', async ({ params, query, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const channelId = parseInt(params.channelId);
        if (isNaN(channelId)) {
          set.status = 400;
          return commonErrorsTypebox.validationError('Invalid channel ID');
        }

        const limit = Math.min(
          parseInt(query.limit || config.defaultLimit!.toString()),
          config.maxLimit!
        );
        
        const excludeIds = query.exclude 
          ? query.exclude.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
          : [];

        const offset = query.cursor 
          ? parseInt(Buffer.from(query.cursor, 'base64').toString()) 
          : 0;

        const whereClause: any = {
          channelId: channelId
        };
        
        if (excludeIds.length > 0) {
          whereClause.id = { notIn: excludeIds };
        }

        const total = await prisma.snap.count({ where: whereClause });

        const snaps = await prisma.snap.findMany({
          where: whereClause,
          select: { id: true },
          orderBy: [
            { views: 'desc' },
            { id: 'desc' }
          ],
          skip: offset,
          take: limit
        });

        const snapIds = snaps.map(snap => snap.id);
        const hasMore = offset + limit < total;
        const nextCursor = hasMore 
          ? Buffer.from((offset + limit).toString()).toString('base64')
          : undefined;

        set.status = 200;
        return createSuccessResponse({
          snapIds,
          total,
          hasMore,
          nextCursor
        });

      } catch (error) {
        console.error('Channel snaps error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Recommendations'],
        summary: 'Get popular snaps from specific channel',
        description: 'Get recommended snaps from a specific channel ordered by popularity'
      },
      params: t.Object({
        channelId: t.String()
      }),
      query: ChannelRecommendedQuerySchema,
      response: {
        200: ApiSuccessResponseTypeBox(RecommendedSnapsResponseSchema),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })

    // GET /recommended/by-tags - Snaps filtered by tags
    .get('/by-tags', async ({ query, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      if (!query.tags) {
        set.status = 400;
        return commonErrorsTypebox.validationError('tags parameter is required');
      }

      try {
        const limit = Math.min(
          parseInt(query.limit || config.defaultLimit!.toString()),
          config.maxLimit!
        );
        
        const excludeIds = query.exclude 
          ? query.exclude.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
          : [];

        const offset = query.cursor 
          ? parseInt(Buffer.from(query.cursor, 'base64').toString()) 
          : 0;

        const tagNames = query.tags.split(',').map(tag => tag.trim());

        const whereClause: any = {
          tags: {
            some: {
              name: { in: tagNames }
            }
          }
        };
        
        if (excludeIds.length > 0) {
          whereClause.id = { notIn: excludeIds };
        }

        if (query.minViews) {
          whereClause.views = { gte: parseInt(query.minViews) };
        }

        const total = await prisma.snap.count({ where: whereClause });

        const snaps = await prisma.snap.findMany({
          where: whereClause,
          select: { id: true },
          orderBy: [
            { views: 'desc' },
            { id: 'desc' }
          ],
          skip: offset,
          take: limit
        });

        const snapIds = snaps.map(snap => snap.id);
        const hasMore = offset + limit < total;
        const nextCursor = hasMore 
          ? Buffer.from((offset + limit).toString()).toString('base64')
          : undefined;

        set.status = 200;
        return createSuccessResponse({
          snapIds,
          total,
          hasMore,
          nextCursor
        });

      } catch (error) {
        console.error('Tag-based snaps error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Recommendations'],
        summary: 'Get snaps filtered by tags',
        description: 'Get recommended snaps filtered by specific tags'
      },
      query: t.Object({
        tags: t.String(),
        limit: t.Optional(t.String()),
        exclude: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        minViews: t.Optional(t.String())
      }),
      response: {
        200: ApiSuccessResponseTypeBox(RecommendedSnapsResponseSchema),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};