import { Elysia, t } from 'elysia';
import type { PrismaClient } from '@prisma/client';
import { 
  createSuccessResponse,
  commonErrorsTypebox,
  ApiSuccessResponseTypeBox,
  ApiErrorResponseTypeBox,
} from '@vinxen/shared/schema/ApiResponseTypebox';
import { 
  generateCRUDOperations,
  validateId,
  filterUndefined,
  type PaginationOptions} from './utils';
import {
  BulkCreateRequestSchema,
  BulkUpdateRequestSchema,
  BulkDeleteRequestSchema,
  ListQuerySchema,
  ModelParamSchema,} from './schemas';
import type { DatabasePluginOptions } from './types';
import { compressAvatarImage, getBase64ImageSize, shouldCompressImage, validateImageBase64 } from '@vinxen/shared';

const DEFAULT_OPTIONS: Required<Omit<DatabasePluginOptions, 'permissions'>> & { permissions: DatabasePluginOptions['permissions'] } = {
  prefix: '',
  models: [],
  enableBulkOperations: true,
  maxLimit: 100,
  permissions: undefined,
  requireAuth: false
};

export const database = (
  prisma: PrismaClient,
  options: DatabasePluginOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  return new Elysia({ name: 'database', prefix: config.prefix })
    .decorate('prisma', prisma)
    .decorate('crudOps', (modelName: string) => generateCRUDOperations(prisma, modelName))

    .post('/create-channel', async ({ body, set, ...ctx }) => {
      const { name, instruction, avatar } = body as any;
      if (!(ctx as any).user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }
      const userId = (ctx as any).user.id;
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
      try {
        const result = await prisma.channel.create({ data: {
          name: name,
          instruction: instruction,
          avatar: processedAvatar,
          authorId: userId,
          },
          include: {
            author: true,
            snaps: true,
            followers: true,
          },
        });
        set.status = 201;
        return createSuccessResponse(result);
      } catch (error) {
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      detail: {
        tags: ['CRUD'],
        summary: 'Create a new channel',
        description: 'Create a new channel'
      },
      body: t.Object({
        name: t.String(),
        instruction: t.String(),
        avatar: t.String(),
      }),
      response: {
        201: ApiSuccessResponseTypeBox(),
        400: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox,
      }
    })
    
    // Generic CRUD routes for any model
    .group('/:model', (app) => 
      app
        .derive(({ params: { model } }) => {
          if (config.models.length > 0 && !config.models.includes(model)) {
            throw new Error(`Model ${model} is not enabled`);
          }
          return { modelName: model };
        })
        
        // GET /:model - List with pagination
        .get('/', async ({ query, modelName, set, ...ctx }) => {
          // 권한 검사
          const user = (ctx as any).user;
          if (config.requireAuth && !user) {
            set.status = 401;
            return commonErrorsTypebox.unauthorized();
          }
          try {
            const ops = generateCRUDOperations(prisma, modelName);
            const pagination: PaginationOptions = {
              page: query.page ? parseInt(query.page as string) : undefined,
              limit: query.limit ? parseInt(query.limit as string) : undefined,
              orderBy: query.orderBy ? JSON.parse(query.orderBy as string) : undefined
            };
            
            const where = filterUndefined({
              ...Object.fromEntries(
                Object.entries(query).filter(([key]) => 
                  !['page', 'limit', 'orderBy', 'include'].includes(key)
                )
              )
            });
            
            const include = query.include ? JSON.parse(query.include as string) : undefined;
            
            const result = await ops.findMany(pagination, where, include, user?.id);
            
            set.status = 200;
            return createSuccessResponse(result);
          } catch (error) {
            set.status = 500;
            return commonErrorsTypebox.internalError();
          }
        }, {
          detail: {
            tags: ['CRUD'],
            summary: 'List items with pagination',
            description: 'Retrieve a paginated list of items from the specified model'
          },
          query: ListQuerySchema,
          params: ModelParamSchema,
          response: {
            200: ApiSuccessResponseTypeBox(),
            500: ApiErrorResponseTypeBox
          }
        })
        
        // POST /:model - Create
        .post('/', async ({ body, modelName, set, ...ctx }) => {
          // 권한 검사
          const user = (ctx as any).user;
          if (config.requireAuth && !user) {
            set.status = 401;
            return commonErrorsTypebox.unauthorized();
          }
          try {
            const ops = generateCRUDOperations(prisma, modelName);
            const result = await ops.create(body as Record<string, any>, user?.id);
            
            set.status = 201;
            return createSuccessResponse(result);
          } catch (error) {
            set.status = 500;
            return commonErrorsTypebox.internalError();
          }
        }, {
          detail: {
            tags: ['CRUD'],
            summary: 'Create a new item',
            description: 'Create a new item in the specified model'
          },
          params: ModelParamSchema,
          response: {
            201: ApiSuccessResponseTypeBox(),
            500: ApiErrorResponseTypeBox
          }
        })
        
        // GET /:model/:id - Find by ID
        .get('/:id', async ({ params: { id }, modelName, set, ...ctx }) => {
          // 권한 검사
          const user = (ctx as any).user;
          if (config.requireAuth && !user) {
            set.status = 401;
            return commonErrorsTypebox.unauthorized();
          }
          try {
            const numId = validateId(id);
            const ops = generateCRUDOperations(prisma, modelName);
            const result = await ops.findById(numId, user?.id);
            
            if (!result) {
              set.status = 404;
              return commonErrorsTypebox.notFound(modelName);
            }
            
            set.status = 200;
            return createSuccessResponse(result);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Invalid ID')) {
              set.status = 400;
              return commonErrorsTypebox.validationError(error.message);
            }
            set.status = 500;
            return commonErrorsTypebox.internalError();
          }
        }, {
          detail: {
            tags: ['CRUD'],
            summary: 'Get item by ID',
            description: 'Retrieve a single item by its ID from the specified model'
          },
          params: t.Object({
            model: t.String(),
            id: t.String()
          }),
          response: {
            200: ApiSuccessResponseTypeBox(),
            400: ApiErrorResponseTypeBox,
            404: ApiErrorResponseTypeBox,
            500: ApiErrorResponseTypeBox
          }
        })
        
        // PUT /:model/:id - Update
        .put('/:id', async ({ params: { id }, body, modelName, set, ...ctx }) => {
          // 권한 검사
          const user = (ctx as any).user;
          if (config.requireAuth && !user) {
            set.status = 401;
            return commonErrorsTypebox.unauthorized();
          }
          try {
            const numId = validateId(id);
            const ops = generateCRUDOperations(prisma, modelName);
            const result = await ops.update(numId, body as Record<string, any>, user?.id);
            
            set.status = 200;
            return createSuccessResponse(result);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Invalid ID')) {
              set.status = 400;
              return commonErrorsTypebox.validationError(error.message);
            }
            set.status = 500;
            return commonErrorsTypebox.internalError();
          }
        }, {
          detail: {
            tags: ['CRUD'],
            summary: 'Update item by ID',
            description: 'Update an existing item by its ID in the specified model'
          },
          params: t.Object({
            model: t.String(),
            id: t.String()
          }),
          response: {
            200: ApiSuccessResponseTypeBox(),
            400: ApiErrorResponseTypeBox,
            500: ApiErrorResponseTypeBox
          }
        })
        
        // DELETE /:model/:id - Delete
        .delete('/:id', async ({ params: { id }, modelName, set, ...ctx }) => {
          // 권한 검사
          const user = (ctx as any).user;
          if (config.requireAuth && !user) {
            set.status = 401;
            return commonErrorsTypebox.unauthorized();
          }
          try {
            const numId = validateId(id);
            const ops = generateCRUDOperations(prisma, modelName);
            const result = await ops.delete(numId, user?.id);
            
            set.status = 200;
            return createSuccessResponse(result);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Invalid ID')) {
              set.status = 400;
              return commonErrorsTypebox.validationError(error.message);
            }
            set.status = 500;
            return commonErrorsTypebox.internalError();
          }
        }, {
          detail: {
            tags: ['CRUD'],
            summary: 'Delete item by ID',
            description: 'Delete an existing item by its ID from the specified model'
          },
          params: t.Object({
            model: t.String(),
            id: t.String()
          }),
          response: {
            200: ApiSuccessResponseTypeBox(),
            400: ApiErrorResponseTypeBox,
            500: ApiErrorResponseTypeBox
          }
        })
        
        // PATCH /:model/:id - Partial update
        .patch('/:id', async ({ params: { id }, body, modelName, set, ...ctx }) => {
          // 권한 검사
          const user = (ctx as any).user;
          if (config.requireAuth && !user) {
            set.status = 401;
            return commonErrorsTypebox.unauthorized();
          }
          try {
            const numId = validateId(id);
            const ops = generateCRUDOperations(prisma, modelName);
            const filteredBody = filterUndefined(body as Record<string, any>);
            const result = await ops.update(numId, filteredBody, user?.id);
            
            set.status = 200;
            return createSuccessResponse(result);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Invalid ID')) {
              set.status = 400;
              return commonErrorsTypebox.validationError(error.message);
            }
            set.status = 500;
            return commonErrorsTypebox.internalError();
          }
        }, {
          detail: {
            tags: ['CRUD'],
            summary: 'Partially update item by ID',
            description: 'Partially update an existing item by its ID in the specified model'
          },
          params: t.Object({
            model: t.String(),
            id: t.String()
          }),
          response: {
            200: ApiSuccessResponseTypeBox(),
            400: ApiErrorResponseTypeBox,
            500: ApiErrorResponseTypeBox
          }
        })
        
        // Bulk operations (if enabled)
        .group('/bulk', (bulkApp) => {
          if (!config.enableBulkOperations) {
            return bulkApp;
          }
          
          return bulkApp
            // POST /:model/bulk - Create many
            .post('/', async ({ body, modelName, set, ...ctx }) => {
              const user = (ctx as any).user;
              try {
                const ops = generateCRUDOperations(prisma, modelName);
                const result = await ops.createMany(Array.isArray(body) ? body : [body], user?.id);
                
                set.status = 201;
                return createSuccessResponse(result);
              } catch (error) {
                set.status = 500;
                return commonErrorsTypebox.internalError();
              }
            }, {
              detail: {
                tags: ['Bulk'],
                summary: 'Create multiple items',
                description: 'Create multiple items in the specified model'
              },
              body: BulkCreateRequestSchema,
              params: ModelParamSchema,
              response: {
                201: ApiSuccessResponseTypeBox(),
                500: ApiErrorResponseTypeBox
              }
            })
            
            // PUT /:model/bulk - Update many
            .put('/', async ({ body, modelName, set, ...ctx }) => {
              const user = (ctx as any).user;
              try {
                const ops = generateCRUDOperations(prisma, modelName);
                const { where, data } = body as { where: Record<string, any>, data: Record<string, any> };
                const result = await ops.updateMany(where, data, user?.id);
                
                set.status = 200;
                return createSuccessResponse(result);
              } catch (error) {
                set.status = 500;
                return commonErrorsTypebox.internalError();
              }
            }, {
              detail: {
                tags: ['Bulk'],
                summary: 'Update multiple items',
                description: 'Update multiple items in the specified model based on filter conditions'
              },
              body: BulkUpdateRequestSchema,
              params: ModelParamSchema,
              response: {
                200: ApiSuccessResponseTypeBox(),
                500: ApiErrorResponseTypeBox
              }
            })
            
            // DELETE /:model/bulk - Delete many
            .delete('/', async ({ body, modelName, set, ...ctx }) => {
              const user = (ctx as any).user;
              try {
                const ops = generateCRUDOperations(prisma, modelName);
                const where = body as Record<string, any>;
                const result = await ops.deleteMany(where, user?.id);
                
                set.status = 200;
                return createSuccessResponse(result);
              } catch (error) {
                set.status = 500;
                return commonErrorsTypebox.internalError();
              }
            }, {
              detail: {
                tags: ['Bulk'],
                summary: 'Delete multiple items',
                description: 'Delete multiple items in the specified model based on filter conditions'
              },
              body: BulkDeleteRequestSchema,
              params: ModelParamSchema,
              response: {
                200: ApiSuccessResponseTypeBox(),
                500: ApiErrorResponseTypeBox
              }
            });
        })
    );
};

export default database;