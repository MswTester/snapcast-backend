import { Elysia, t } from 'elysia';
import type { PrismaClient } from '@prisma/client';
import { 
  ApiSuccessResponseTypeBox,
  ApiErrorResponseTypeBox,
  commonErrorsTypebox,
  createSuccessResponse,
} from '@vinxen/shared/schema/ApiResponseTypebox';
import { toPublicUser } from '@vinxen/shared/schema/auth';
import { requireAuth, requirePlan } from './middleware';

// Subscription request schemas
const SubscribeToPlanSchema = t.Object({
  planId: t.Number({ minimum: 1 }),
});

// Subscription response schemas
const PlanSchema = t.Object({
  id: t.Number(),
  name: t.String(),
  price: t.Number()
});

const PlansListResponseSchema = t.Array(PlanSchema);

const SubscribeResponseSchema = t.Object({
  message: t.String(),
  user: t.Object({
    id: t.Number(),
    email: t.String(),
    name: t.String(),
    avatar: t.String(),
    gender: t.Union([t.Literal('MALE'), t.Literal('FEMALE')]),
    isActive: t.Boolean(),
    isVerified: t.Boolean(),
    lastLogin: t.Optional(t.String()),
    createdAt: t.String(),
    updatedAt: t.String(),
    plan: t.Optional(PlanSchema),
    myChannel: t.Optional(t.Object({
      id: t.Number(),
      name: t.String(),
      avatar: t.String(),
      instruction: t.String(),
      authorId: t.Number()
    })),
    followings: t.Array(t.Object({
      id: t.Number(),
      name: t.String(),
      avatar: t.String(),
      instruction: t.String(),
      author: t.Object({
        id: t.Number(),
        name: t.String(),
        email: t.String()
      })
    }))
  })
});

const UnsubscribeResponseSchema = t.Object({
  message: t.String(),
  user: t.Object({
    id: t.Number(),
    email: t.String(),
    name: t.String(),
    avatar: t.String(),
    gender: t.Union([t.Literal('MALE'), t.Literal('FEMALE')]),
    isActive: t.Boolean(),
    isVerified: t.Boolean(),
    lastLogin: t.Optional(t.String()),
    createdAt: t.String(),
    updatedAt: t.String(),
    plan: t.Optional(PlanSchema),
    myChannel: t.Optional(t.Object({
      id: t.Number(),
      name: t.String(),
      avatar: t.String(),
      instruction: t.String(),
      authorId: t.Number()
    })),
    followings: t.Array(t.Object({
      id: t.Number(),
      name: t.String(),
      avatar: t.String(),
      instruction: t.String(),
      author: t.Object({
        id: t.Number(),
        name: t.String(),
        email: t.String()
      })
    }))
  })
});

const StatusResponseSchema = t.Object({
  hasSubscription: t.Boolean(),
  plan: t.Optional(PlanSchema)
});

const subscription = (prisma: PrismaClient) => new Elysia({ name: 'subscription' })
  .decorate('requireAuth', () => requireAuth())
  .decorate('requirePlan', (planName: string) => requirePlan(prisma, planName))
  
  // GET /subscription/plans - Get all available plans
  .get('/plans', async ({ set }) => {
    try {
      const plans = await prisma.plan.findMany({
        orderBy: { price: 'asc' }
      });
      
      set.status = 200;
      return createSuccessResponse(plans);
    } catch (error) {
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Subscription'],
      summary: 'Get all available plans',
      description: 'Retrieve a list of all available subscription plans'
    },
    response: {
      200: ApiSuccessResponseTypeBox(PlansListResponseSchema),
      500: ApiErrorResponseTypeBox,
    }
  })
  
  // POST /subscription/subscribe - Subscribe to a plan
  .post('/subscribe', async ({ body, set, ...ctx }) => {
    const { planId } = body;
    const user = (ctx as any).user;
    
    if (!user) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }
    
    try {
      // Check if plan exists
      const plan = await prisma.plan.findUnique({
        where: { id: planId }
      });
      
      if (!plan) {
        set.status = 404;
        return commonErrorsTypebox.notFound('Plan');
      }
      
      // Update user's plan
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { planId: planId },
        include: {
          myChannel: true,
          followings: {
            include: {
              author: {
                select: { id: true, name: true, email: true, avatar: true }
              }
            }
          },
          plan: true
        }
      });
      
      set.status = 200;
      return createSuccessResponse({
        message: `Successfully subscribed to ${plan.name} plan`,
        user: toPublicUser(updatedUser)
      });
    } catch (error) {
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Subscription'],
      summary: 'Subscribe to a plan',
      description: 'Subscribe the authenticated user to a specific plan'
    },
    body: SubscribeToPlanSchema,
    response: {
      200: ApiSuccessResponseTypeBox(SubscribeResponseSchema),
      401: ApiErrorResponseTypeBox,
      404: ApiErrorResponseTypeBox,
      500: ApiErrorResponseTypeBox,
    }
  })
  
  // POST /subscription/unsubscribe - Unsubscribe from current plan
  .post('/unsubscribe', async ({ set, ...ctx }) => {
    const user = (ctx as any).user;
    
    if (!user) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }
    
    try {
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { planId: null },
        include: {
          myChannel: true,
          followings: {
            include: {
              author: {
                select: { id: true, name: true, email: true, avatar: true }
              }
            }
          },
          plan: true
        }
      });
      
      set.status = 200;
      return createSuccessResponse({
        message: 'Successfully unsubscribed from plan',
        user: toPublicUser(updatedUser)
      });
    } catch (error) {
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Subscription'],
      summary: 'Unsubscribe from plan',
      description: 'Remove the authenticated user from their current subscription plan'
    },
    response: {
      200: ApiSuccessResponseTypeBox(UnsubscribeResponseSchema),
      401: ApiErrorResponseTypeBox,
      500: ApiErrorResponseTypeBox,
    }
  })
  
  // GET /subscription/status - Get current subscription status
  .get('/status', async ({ set, ...ctx }) => {
    const user = (ctx as any).user;
    
    if (!user) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }
    
    try {
      const userWithPlan = await prisma.user.findUnique({
        where: { id: user.id },
        include: { plan: true }
      });
      
      if (!userWithPlan) {
        set.status = 404;
        return commonErrorsTypebox.notFound('User');
      }
      
      set.status = 200;
      return createSuccessResponse({
        hasSubscription: !!userWithPlan.plan,
        plan: userWithPlan.plan
      });
    } catch (error) {
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Subscription'],
      summary: 'Get subscription status',
      description: 'Get the current subscription status of the authenticated user'
    },
    response: {
      200: ApiSuccessResponseTypeBox(StatusResponseSchema),
      401: ApiErrorResponseTypeBox,
      404: ApiErrorResponseTypeBox,
      500: ApiErrorResponseTypeBox,
    }
  });

export default subscription;