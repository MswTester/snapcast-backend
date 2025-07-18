import { z } from 'zod';
import type { User } from '@prisma/client';

// Channel schema for nested data
export const ChannelSchema = z.object({
  id: z.number(),
  name: z.string(),
  avatar: z.string(),
  instruction: z.string(),
  authorId: z.number(),
});

// Plan schema for nested data
export const PlanSchema = z.object({
  id: z.number(),
  name: z.string(),
  price: z.number(),
});

// Base user schema (excluding sensitive fields)
export const UserPublicSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  avatar: z.string(),
  gender: z.enum(['MALE', 'FEMALE']),
  isActive: z.boolean(),
  isVerified: z.boolean(),
  lastLogin: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  myChannel: ChannelSchema.nullable(),
  followings: z.array(ChannelSchema),
  plan: PlanSchema.nullable(),
});

// Auth request schemas
export const LoginRequestSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const RegisterRequestSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  name: z.string().min(1, 'Name is required'),
  avatar: z.string().min(1, 'Avatar is required'),
  gender: z.enum(['MALE', 'FEMALE']),
});

// JWT payload schemas
export const JWTPayloadSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  type: z.enum(['access', 'refresh']),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export const RefreshTokenPayloadSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  type: z.literal('refresh'),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

// Auth response schemas
export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const AuthResponseSchema = z.object({
  user: UserPublicSchema,
  tokens: AuthTokensSchema,
});

// User context schema (for middleware)
export const UserContextSchema = z.object({
  id: z.number(),
  email: z.string().email(),
});

// Type exports
export type UserPublic = z.infer<typeof UserPublicSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type JWTPayload = z.infer<typeof JWTPayloadSchema>;
export type RefreshTokenPayload = z.infer<typeof RefreshTokenPayloadSchema>;
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type UserContext = z.infer<typeof UserContextSchema>;

// Utility function to transform Prisma User to public user
export const toPublicUser = (user: any): UserPublic => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatar: user.avatar,
  gender: user.gender,
  isActive: user.isActive,
  isVerified: user.isVerified,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  myChannel: user.myChannel ? {
    id: user.myChannel.id,
    name: user.myChannel.name,
    avatar: user.myChannel.avatar,
    instruction: user.myChannel.instruction,
    authorId: user.myChannel.authorId,
  } : null,
  followings: user.followings?.map((channel: any) => ({
    id: channel.id,
    name: channel.name,
    avatar: channel.avatar,
    instruction: channel.instruction,
    authorId: channel.authorId,
  })) || [],
  plan: user.plan ? {
    id: user.plan.id,
    name: user.plan.name,
    price: user.plan.price,
  } : null,
});