import { Elysia, t } from 'elysia';
import { PrismaClient } from '@prisma/client';
import { ApiSuccessResponseTypeBox, createSuccessResponse, commonErrorsTypebox, ApiErrorResponseTypeBox } from '@vinxen/shared/schema/ApiResponseTypebox';

export interface SnapDetailOptions {
  requireAuth?: boolean;
  maxRelatedLimit?: number;
  defaultRelatedLimit?: number;
}

const DEFAULT_OPTIONS: SnapDetailOptions = {
  requireAuth: false,
  maxRelatedLimit: 20,
  defaultRelatedLimit: 5
};

// Response schemas
const SnapDetailResponseSchema = t.Object({
  id: t.Number(),
  title: t.String(),
  duration: t.Number(),
  views: t.Number(),
  audio: t.String(),
  streamUrl: t.String(),
  channel: t.Object({
    id: t.Number(),
    name: t.String(),
    instruction: t.String(),
    author: t.Object({
      id: t.Number(),
      name: t.String(),
      gender: t.Union([t.Literal('MALE'), t.Literal('FEMALE')])
    })
  }),
  tags: t.Array(t.Object({
    id: t.Number(),
    name: t.String()
  })),
  contexts: t.Array(t.Object({
    id: t.Number(),
    message: t.String(),
    timeline: t.Number()
  }))
});

const RelatedSnapsResponseSchema = t.Object({
  snapIds: t.Array(t.Number()),
  total: t.Number(),
  hasMore: t.Boolean()
});

const RelatedSnapsQuerySchema = t.Object({
  limit: t.Optional(t.String()),
  exclude: t.Optional(t.String())
});

export const snapDetail = (
  prisma: PrismaClient,
  options: SnapDetailOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return new Elysia({ name: 'snap-detail', prefix: '/snap' })
    .decorate('prisma', prisma)
    
    // GET /snap/:id/info - Get full snap metadata
    .get('/:id/info', async ({ params, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.id);
        if (isNaN(snapId)) {
          set.status = 400;
          return commonErrorsTypebox.validationError('Invalid snap ID');
        }

        const snap = await prisma.snap.findUnique({
          where: { id: snapId },
          include: {
            channel: {
              include: {
                author: {
                  select: {
                    id: true,
                    name: true,
                    gender: true
                  }
                }
              }
            },
            tags: {
              select: {
                id: true,
                name: true
              }
            },
            contexts: {
              select: {
                id: true,
                message: true,
                timeline: true
              },
              orderBy: {
                timeline: 'asc'
              }
            }
          }
        });

        if (!snap) {
          set.status = 404;
          return commonErrorsTypebox.notFound('Snap not found');
        }

        // Check access permissions if auth is required
        if (config.requireAuth && user) {
          const isOwner = snap.channel.author.id === user.id;
          const isSubscriber = user.planId !== null;
          
          if (!isOwner && !isSubscriber) {
            set.status = 403;
            return commonErrorsTypebox.forbidden('Access denied');
          }
        }

        // Increment view count
        await prisma.snap.update({
          where: { id: snapId },
          data: { views: { increment: 1 } }
        });

        const response = {
          id: snap.id,
          title: snap.title,
          duration: snap.duration,
          views: snap.views + 1, // Return updated view count
          audio: snap.audio,
          streamUrl: `/snap/${snap.id}`,
          channel: {
            id: snap.channel.id,
            name: snap.channel.name,
            instruction: snap.channel.instruction,
            author: {
              id: snap.channel.author.id,
              name: snap.channel.author.name,
              gender: snap.channel.author.gender
            }
          },
          tags: snap.tags,
          contexts: snap.contexts
        };

        set.status = 200;
        return createSuccessResponse(response);

      } catch (error) {
        console.error('Snap detail error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Snap Detail'],
        summary: 'Get full snap metadata',
        description: 'Get complete metadata for a specific snap including channel, tags, and contexts'
      },
      params: t.Object({
        id: t.String()
      }),
      response: {
        200: ApiSuccessResponseTypeBox(SnapDetailResponseSchema),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })

    // GET /snap/:id/related - Get related snap IDs
    .get('/:id/related', async ({ params, query, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const snapId = parseInt(params.id);
        if (isNaN(snapId)) {
          set.status = 400;
          return commonErrorsTypebox.validationError('Invalid snap ID');
        }

        const limit = Math.min(
          parseInt(query.limit || config.defaultRelatedLimit!.toString()),
          config.maxRelatedLimit!
        );
        
        const excludeIds = query.exclude 
          ? query.exclude.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
          : [];

        // Add the current snap ID to exclude list
        excludeIds.push(snapId);

        // Get the current snap to find related content
        const currentSnap = await prisma.snap.findUnique({
          where: { id: snapId },
          include: {
            channel: true,
            tags: {
              select: { name: true }
            }
          }
        });

        if (!currentSnap) {
          set.status = 404;
          return commonErrorsTypebox.notFound('Snap not found');
        }

        // Strategy for finding related snaps:
        // 1. Same channel (highest priority)
        // 2. Same tags
        // 3. Same author
        // 4. Popular snaps as fallback

        const relatedSnaps = [];
        
        // 1. Same channel snaps
        if (relatedSnaps.length < limit) {
          const channelSnaps = await prisma.snap.findMany({
            where: {
              channelId: currentSnap.channelId,
              id: { notIn: excludeIds }
            },
            select: { id: true },
            orderBy: { views: 'desc' },
            take: limit - relatedSnaps.length
          });
          
          relatedSnaps.push(...channelSnaps);
          excludeIds.push(...channelSnaps.map(s => s.id));
        }

        // 2. Same tags
        if (relatedSnaps.length < limit && currentSnap.tags.length > 0) {
          const tagNames = currentSnap.tags.map(tag => tag.name);
          const tagSnaps = await prisma.snap.findMany({
            where: {
              tags: {
                some: {
                  name: { in: tagNames }
                }
              },
              id: { notIn: excludeIds }
            },
            select: { id: true },
            orderBy: { views: 'desc' },
            take: limit - relatedSnaps.length
          });
          
          relatedSnaps.push(...tagSnaps);
          excludeIds.push(...tagSnaps.map(s => s.id));
        }

        // 3. Same author
        if (relatedSnaps.length < limit) {
          const authorSnaps = await prisma.snap.findMany({
            where: {
              authorId: currentSnap.authorId,
              id: { notIn: excludeIds }
            },
            select: { id: true },
            orderBy: { views: 'desc' },
            take: limit - relatedSnaps.length
          });
          
          relatedSnaps.push(...authorSnaps);
          excludeIds.push(...authorSnaps.map(s => s.id));
        }

        // 4. Popular snaps as fallback
        if (relatedSnaps.length < limit) {
          const popularSnaps = await prisma.snap.findMany({
            where: {
              id: { notIn: excludeIds }
            },
            select: { id: true },
            orderBy: { views: 'desc' },
            take: limit - relatedSnaps.length
          });
          
          relatedSnaps.push(...popularSnaps);
        }

        // Get total count for hasMore calculation
        const totalRelated = await prisma.snap.count({
          where: {
            OR: [
              { channelId: currentSnap.channelId },
              { authorId: currentSnap.authorId },
              ...(currentSnap.tags.length > 0 ? [{
                tags: {
                  some: {
                    name: { in: currentSnap.tags.map(tag => tag.name) }
                  }
                }
              }] : [])
            ],
            id: { notIn: [snapId] }
          }
        });

        const snapIds = relatedSnaps.map(snap => snap.id);
        const hasMore = totalRelated > limit;

        set.status = 200;
        return createSuccessResponse({
          snapIds,
          total: totalRelated,
          hasMore
        });

      } catch (error) {
        console.error('Related snaps error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['Snap Detail'],
        summary: 'Get related snap IDs',
        description: 'Get IDs of snaps related to the current snap based on channel, tags, and author'
      },
      params: t.Object({
        id: t.String()
      }),
      query: RelatedSnapsQuerySchema,
      response: {
        200: ApiSuccessResponseTypeBox(RelatedSnapsResponseSchema),
        400: ApiErrorResponseTypeBox,
        401: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};