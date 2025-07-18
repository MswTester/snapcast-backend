import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import type { PrismaClient } from '@prisma/client';
import { 
  LoginRequestSchema,
  RegisterRequestSchema,
  toPublicUser,
  type AuthResponse,
  type RefreshTokenPayload,
  type UserContext,
} from '@vinxen/shared/schema/auth';
import { 
  LoginRequestTypeBox,
  RegisterRequestTypeBox,
} from '@vinxen/shared/schema/auth/typebox';
import { 
  ApiSuccessResponseTypeBox,
  ApiErrorResponseTypeBox,
  commonErrorsTypebox,
  createSuccessResponse,
} from '@vinxen/shared/schema/ApiResponseTypebox';
import { hashPassword, verifyPassword, generateTokens, validateEmail, validatePassword } from './utils';
import { getAccessTokenExpiryMs, getRefreshTokenExpiryMs, msToSeconds } from './time-utils';
import { 
  compressAvatarImage, 
  validateImageBase64, 
  shouldCompressImage,
  getBase64ImageSize 
} from '@vinxen/shared';
import { 
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireResourcePermission,
  requireOwnership,
  requirePermissionOrOwnership,
  requirePlan,
  requirePlanTier,
  requireActiveSubscription
} from './middleware';
import subscription from './subscription';

const auth = (prisma: PrismaClient) => new Elysia({ name:'auth', prefix: '/auth' })
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
  .decorate('user', null as unknown as UserContext)
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
  .decorate('requireAuth', () => requireAuth())
  .decorate('requirePermission', (permission: string) => requirePermission(prisma, permission))
  .decorate('requireAnyPermission', (permissions: string[]) => requireAnyPermission(prisma, permissions))
  .decorate('requireAllPermissions', (permissions: string[]) => requireAllPermissions(prisma, permissions))
  .decorate('requireResourcePermission', (resource: string, action: string) => requireResourcePermission(prisma, resource, action))
  .decorate('requireOwnership', (resourceModel: string, resourceIdField?: string) => requireOwnership(prisma, resourceModel, resourceIdField))
  .decorate('requirePermissionOrOwnership', (permission: string, resourceModel: string, resourceIdField?: string) => requirePermissionOrOwnership(prisma, permission, resourceModel, resourceIdField))
  .decorate('requirePlan', (planName: string) => requirePlan(prisma, planName))
  .decorate('requirePlanTier', (minTierPrice: number) => requirePlanTier(prisma, minTierPrice))
  .decorate('requireActiveSubscription', () => requireActiveSubscription(prisma))
  .post('/login', async ({ accessJwt, refreshJwt, body, cookie: { accessToken, refreshToken }, set }) => {
    const { email, password } = body as any;
    if (!email || !validateEmail(email)) {
      set.status = 400;
      return commonErrorsTypebox.validationError('Valid email is required');
    }
    if (!password) {
      set.status = 400;
      return commonErrorsTypebox.validationError('Password is required');
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email },
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
      
      if (!user) {
        set.status = 404;
        return commonErrorsTypebox.notFound('User');
      }

      const isValidPassword = await verifyPassword(password, user.password);
      if (!isValidPassword) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      // Update lastLogin timestamp
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
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

      const tokens = await generateTokens(user.id, user.email, accessJwt, refreshJwt);
      
      accessToken?.set({
        value: tokens.accessToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: msToSeconds(getAccessTokenExpiryMs())
      });
      
      refreshToken?.set({
        value: tokens.refreshToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: msToSeconds(getRefreshTokenExpiryMs())
      });

      const response: AuthResponse = {
        user: toPublicUser(updatedUser),
        tokens
      };

      set.status = 200;
      return createSuccessResponse(response);
    } catch (error) {
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Authentication'],
      summary: 'User login',
      description: 'Authenticate user with email and password, returns JWT tokens'
    },
    body: LoginRequestTypeBox,
    response: {
      200: ApiSuccessResponseTypeBox(),
      400: ApiErrorResponseTypeBox,
      401: ApiErrorResponseTypeBox,
      500: ApiErrorResponseTypeBox,
    },
    beforeHandle: ({ body, set }) => {
      const validation = LoginRequestSchema.safeParse(body);
      if (!validation.success) {
        set.status = 400;
        return commonErrorsTypebox.validationError(
          validation.error.issues[0]?.message || 'Validation error',
          validation.error.issues
        );
      }
    }
  })
  .post('/register', async ({ body, set, accessJwt, refreshJwt, cookie: { accessToken, refreshToken } }) => {
    const { email, password, name, avatar, gender } = body as any;
    if (!email || !validateEmail(email)) {
      set.status = 400;
      return commonErrorsTypebox.validationError('Valid email is required');
    }
    
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      set.status = 400;
      return commonErrorsTypebox.validationError(passwordValidation.message || 'Invalid password');
    }

    // Validate avatar image
    if (!avatar || !validateImageBase64(avatar)) {
      set.status = 400;
      return commonErrorsTypebox.validationError('Valid avatar image is required');
    }

    // Check avatar size before compression
    const originalSizeKB = getBase64ImageSize(avatar);
    if (originalSizeKB > 5000) { // 5MB limit
      set.status = 400;
      return commonErrorsTypebox.validationError('Avatar image size cannot exceed 5MB');
    }

    // Compress avatar if needed
    let processedAvatar = avatar;
    try {
      if (shouldCompressImage(avatar, 50)) {
        console.log(`🖼️  Compressing avatar image: ${originalSizeKB.toFixed(2)}KB`);
        processedAvatar = await compressAvatarImage(avatar);
        const compressedSizeKB = getBase64ImageSize(processedAvatar);
        console.log(`✅ Avatar compressed: ${compressedSizeKB.toFixed(2)}KB`);
      }
    } catch (error) {
      console.error('Avatar compression failed:', error);
      set.status = 400;
      return commonErrorsTypebox.validationError('Failed to process avatar image');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      set.status = 409;
      return commonErrorsTypebox.conflict('User already exists');
    }

    const hashedPassword = await hashPassword(password);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        avatar: processedAvatar,
        gender,
      },
      include: {
        myChannel: true,
        followings: {
          include: {
            author: {
              select: { id: true, name: true, email: true }
            }
          }
        },
        plan: true
      }
    });

    const tokens = await generateTokens(user.id, user.email, accessJwt, refreshJwt);
    
    accessToken?.set({
      value: tokens.accessToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: msToSeconds(getAccessTokenExpiryMs())
    });
    
    refreshToken?.set({
      value: tokens.refreshToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: msToSeconds(getRefreshTokenExpiryMs())
    });

    const response: AuthResponse = {
      user: toPublicUser(user),
      tokens
    };

    set.status = 201;
    return createSuccessResponse(response);
  }, {
    detail: {
      tags: ['Authentication'],
      summary: 'User registration',
      description: 'Create a new user account with email, password, and name'
    },
    body: RegisterRequestTypeBox,
    response: {
      201: ApiSuccessResponseTypeBox(),
      400: ApiErrorResponseTypeBox,
      409: ApiErrorResponseTypeBox,
      500: ApiErrorResponseTypeBox,
    },
    beforeHandle: ({ body, set }) => {
      const validation = RegisterRequestSchema.safeParse(body);
      if (!validation.success) {
        set.status = 400;
        return commonErrorsTypebox.validationError(
          validation.error.issues[0]?.message || 'Validation error',
          validation.error.issues
        );
      }
    }
  })
  .get('/me', async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }

    try {
      const fuser = await prisma.user.findUnique({
        where: { id: user.id as number },
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

      if (!fuser) {
        set.status = 404;
        return commonErrorsTypebox.notFound('User');
      }

      set.status = 200;
      return createSuccessResponse(toPublicUser(fuser));
    } catch (error) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }
  }, {
    detail: {
      tags: ['Authentication'],
      summary: 'Get current user',
      description: 'Retrieve the current authenticated user information'
    },
    response: {
      200: ApiSuccessResponseTypeBox(),
      401: ApiErrorResponseTypeBox,
      404: ApiErrorResponseTypeBox,
    }
  })
  .get('/refresh', async ({ refreshJwt, accessJwt, set, cookie: { refreshToken, accessToken } }) => {
    if (!refreshToken?.value) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }

    try {
      const payload = await refreshJwt.verify(refreshToken.value) as unknown as RefreshTokenPayload;
      
      if (payload.type !== 'refresh') {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      const newTokens = await generateTokens(payload.id, payload.email, accessJwt, refreshJwt);
      
      accessToken?.set({
        value: newTokens.accessToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: msToSeconds(getAccessTokenExpiryMs())
      });
      
      refreshToken?.set({
        value: newTokens.refreshToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: msToSeconds(getRefreshTokenExpiryMs())
      });

      set.status = 200;
      return createSuccessResponse({ tokens: newTokens });
    } catch (error) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }
  }, {
    detail: {
      tags: ['Authentication'],
      summary: 'Refresh access token',
      description: 'Use refresh token to generate new access and refresh tokens'
    },
    response: {
      200: ApiSuccessResponseTypeBox(),
      401: ApiErrorResponseTypeBox,
    }
  })
  .get('/logout', ({ set, cookie: { accessToken, refreshToken } }) => {
    accessToken?.remove();
    refreshToken?.remove();
    set.status = 200;
    return createSuccessResponse({ message: "Logged out successfully" });
  }, {
    detail: {
      tags: ['Authentication'],
      summary: 'User logout',
      description: 'Clear authentication tokens and log out the user'
    },
    response: {
      200: ApiSuccessResponseTypeBox(),
    }
  })
  .patch('/profile', async ({ body, set, user }) => {
    if (!user) {
      set.status = 401;
      return commonErrorsTypebox.unauthorized();
    }

    try {
      const { name, avatar, gender } = body as any;
      const updateData: any = {};

      // Update name if provided
      if (name) {
        updateData.name = name;
      }

      // Update gender if provided
      if (gender && ['MALE', 'FEMALE'].includes(gender)) {
        updateData.gender = gender;
      }

      // Process avatar if provided
      if (avatar) {
        // Validate avatar image
        if (!validateImageBase64(avatar)) {
          set.status = 400;
          return commonErrorsTypebox.validationError('Valid avatar image is required');
        }

        // Check avatar size before compression
        const originalSizeKB = getBase64ImageSize(avatar);
        if (originalSizeKB > 5000) { // 5MB limit
          set.status = 400;
          return commonErrorsTypebox.validationError('Avatar image size cannot exceed 5MB');
        }

        // Compress avatar if needed
        let processedAvatar = avatar;
        try {
          if (shouldCompressImage(avatar, 50)) {
            console.log(`🖼️  Compressing avatar image: ${originalSizeKB.toFixed(2)}KB`);
            processedAvatar = await compressAvatarImage(avatar);
            const compressedSizeKB = getBase64ImageSize(processedAvatar);
            console.log(`✅ Avatar compressed: ${compressedSizeKB.toFixed(2)}KB`);
          }
        } catch (error) {
          console.error('Avatar compression failed:', error);
          set.status = 400;
          return commonErrorsTypebox.validationError('Failed to process avatar image');
        }

        updateData.avatar = processedAvatar;
      }

      // Update user
      const updatedUser = await prisma.user.update({
        where: { id: user.id as number },
        data: updateData,
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
      return createSuccessResponse(toPublicUser(updatedUser));
    } catch (error) {
      console.error('Profile update failed:', error);
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Authentication'],
      summary: 'Update user profile',
      description: 'Update the current authenticated user profile information including avatar'
    },
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      avatar: t.Optional(t.String({ minLength: 1 })),
      gender: t.Optional(t.Union([t.Literal('MALE'), t.Literal('FEMALE')]))
    }),
    response: {
      200: ApiSuccessResponseTypeBox(),
      400: ApiErrorResponseTypeBox,
      401: ApiErrorResponseTypeBox,
      500: ApiErrorResponseTypeBox,
    }
  })
  .use(subscription(prisma))

export default auth;
