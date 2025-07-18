import type { PrismaClient } from '@prisma/client';
import { getImageMiddleware } from './image-middleware';

export type ModelName = keyof PrismaClient;
export type PrismaDelegate = PrismaClient[ModelName];

export interface PaginationOptions {
  page?: number;
  limit?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export const DEFAULT_PAGINATION: Required<PaginationOptions> = {
  page: 1,
  limit: 10,
  orderBy: { id: 'desc' }
};

export const sanitizePagination = (options: PaginationOptions = {}): Required<PaginationOptions> => {
  const page = Math.max(1, options.page || DEFAULT_PAGINATION.page);
  const limit = Math.min(100, Math.max(1, options.limit || DEFAULT_PAGINATION.limit));
  const orderBy = options.orderBy || DEFAULT_PAGINATION.orderBy;
  
  return { page, limit, orderBy };
};

export const createPaginationMeta = (
  page: number,
  limit: number,
  total: number
) => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
};

// Models that have user ownership through authorId
const USER_OWNED_MODELS = ['channel', 'snap'];

// Add ownership filter based on model and user
const addOwnershipFilter = (modelName: string, where: Record<string, any>, userId?: number) => {
  if (!userId) return where;
  
  if (USER_OWNED_MODELS.includes(modelName.toLowerCase())) {
    return { ...where, authorId: userId };
  }
  
  // For user model, only allow access to own profile
  if (modelName.toLowerCase() === 'user') {
    return { ...where, id: userId };
  }
  
  return where;
};

export const generateCRUDOperations = <T extends Record<string, any>>(
  prisma: PrismaClient,
  modelName: string
) => {
  const delegate = (prisma as any)[modelName];
  
  if (!delegate) {
    throw new Error(`Model ${modelName} not found in Prisma client`);
  }

  return {
    // Create
    async create(data: Partial<T>, userId?: number): Promise<T> {
      let createData = { ...data };
      
      // Auto-set authorId for user-owned models
      if (USER_OWNED_MODELS.includes(modelName.toLowerCase()) && userId) {
        (createData as any).authorId = userId;
      }
      
      // Apply image compression middleware
      const imageMiddleware = getImageMiddleware(modelName);
      if (imageMiddleware?.beforeCreate) {
        createData = await imageMiddleware.beforeCreate(createData);
      }
      
      return await delegate.create({ data: createData });
    },

    // Read One
    async findById(id: number | string, userId?: number): Promise<T | null> {
      const where = addOwnershipFilter(modelName, { id }, userId);
      return await delegate.findUnique({ where });
    },

    // Read Many with pagination
    async findMany(
      options: PaginationOptions = {},
      where: Record<string, any> = {},
      include?: Record<string, any>,
      userId?: number
    ): Promise<PaginatedResult<T>> {
      const { page, limit, orderBy } = sanitizePagination(options);
      const skip = (page - 1) * limit;
      
      const filteredWhere = addOwnershipFilter(modelName, where, userId);

      const [data, total] = await Promise.all([
        delegate.findMany({
          where: filteredWhere,
          include,
          skip,
          take: limit,
          orderBy
        }),
        delegate.count({ where: filteredWhere })
      ]);

      return {
        data,
        meta: createPaginationMeta(page, limit, total)
      };
    },

    // Update
    async update(id: number | string, data: Partial<T>, userId?: number): Promise<T> {
      let updateData = { ...data };
      
      // Apply image compression middleware
      const imageMiddleware = getImageMiddleware(modelName);
      if (imageMiddleware?.beforeUpdate) {
        updateData = await imageMiddleware.beforeUpdate(updateData);
      }
      
      const where = addOwnershipFilter(modelName, { id }, userId);
      return await delegate.update({
        where,
        data: updateData
      });
    },

    // Delete
    async delete(id: number | string, userId?: number): Promise<T> {
      const where = addOwnershipFilter(modelName, { id }, userId);
      return await delegate.delete({ where });
    },

    // Upsert
    async upsert(
      where: Record<string, any>,
      create: Partial<T>,
      update: Partial<T>,
      userId?: number
    ): Promise<T> {
      const filteredWhere = addOwnershipFilter(modelName, where, userId);
      
      let createData = { ...create };
      let updateData = { ...update };
      
      // Apply image compression middleware
      const imageMiddleware = getImageMiddleware(modelName);
      if (imageMiddleware?.beforeCreate) {
        createData = await imageMiddleware.beforeCreate(createData);
      }
      if (imageMiddleware?.beforeUpdate) {
        updateData = await imageMiddleware.beforeUpdate(updateData);
      }
      
      if (USER_OWNED_MODELS.includes(modelName.toLowerCase()) && userId) {
        (createData as any).authorId = userId;
      }
      
      return await delegate.upsert({
        where: filteredWhere,
        create: createData,
        update: updateData
      });
    },

    // Bulk operations
    async createMany(data: Partial<T>[], userId?: number): Promise<{ count: number }> {
      const imageMiddleware = getImageMiddleware(modelName);
      
      const createData = await Promise.all(data.map(async item => {
        let newItem = { ...item };
        
        // Apply image compression middleware
        if (imageMiddleware?.beforeCreate) {
          newItem = await imageMiddleware.beforeCreate(newItem);
        }
        
        if (USER_OWNED_MODELS.includes(modelName.toLowerCase()) && userId) {
          (newItem as any).authorId = userId;
        }
        
        return newItem;
      }));
      
      return await delegate.createMany({ data: createData });
    },

    async updateMany(
      where: Record<string, any>,
      data: Partial<T>,
      userId?: number
    ): Promise<{ count: number }> {
      let updateData = { ...data };
      
      // Apply image compression middleware
      const imageMiddleware = getImageMiddleware(modelName);
      if (imageMiddleware?.beforeUpdate) {
        updateData = await imageMiddleware.beforeUpdate(updateData);
      }
      
      const filteredWhere = addOwnershipFilter(modelName, where, userId);
      return await delegate.updateMany({ where: filteredWhere, data: updateData });
    },

    async deleteMany(where: Record<string, any>, userId?: number): Promise<{ count: number }> {
      const filteredWhere = addOwnershipFilter(modelName, where, userId);
      return await delegate.deleteMany({ where: filteredWhere });
    }
  };
};

export const validateId = (id: string | number): number => {
  const numId = typeof id === 'string' ? parseInt(id, 10) : id;
  
  if (isNaN(numId) || numId <= 0) {
    throw new Error('Invalid ID: must be a positive number');
  }
  
  return numId;
};

export const filterUndefined = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const filtered = {} as Partial<T>;
  
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      filtered[key as keyof T] = value;
    }
  }
  
  return filtered;
};