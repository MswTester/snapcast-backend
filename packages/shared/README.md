# Shared Package Development Guide

## Directory Structure

```
packages/shared/
├── schema/
│   ├── user.ts          # Zod schema (default)
│   ├── userTypebox.ts   # TypeBox schema
│   ├── userYup.ts       # Yup schema
│   └── index.ts
├── types/
│   ├── common.ts        # Pure TS types
│   └── index.ts
└── index.ts
```

## File Classification Rules

### 📁 `schema/` - Runtime Validation Schemas
- **Default**: Use Zod → filename as-is (`user.ts`)
- **Other libraries**: Add library name suffix (`userTypebox.ts`, `userYup.ts`)

### 📁 `types/` - Compile-time Types
- Pure TypeScript types: interface, type, enum, etc.

## Naming Conventions

### Schema Filenames
```typescript
// Zod (default)
user.ts
apiResponse.ts

// Other libraries
userTypebox.ts
apiResponseYup.ts
```

### Export Naming
```typescript
// Zod - base name
export const UserSchema = z.object({...});

// TypeBox - add suffix
export const UserTypeBox = Type.Object({...});

// Yup - add suffix
export const UserYup = yup.object({...});
```

## Real Examples

### Zod Schema (Default)
```typescript
// schema/user.ts
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
});

export const CreateUserSchema = UserSchema.omit({ id: true });
```

### TypeBox Schema
```typescript
// schema/userTypebox.ts
import { Type, type Static } from '@sinclair/typebox';

export const UserTypeBox = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
  name: Type.String({ minLength: 1 }),
});

export const CreateUserTypeBox = Type.Omit(UserTypeBox, ['id']);
export type UserType = Static<typeof UserTypeBox>;
```

### Pure Types
```typescript
// types/common.ts
export interface User {
  id: string;
  email: string;
  name: string;
}

export type UserRole = 'admin' | 'user' | 'guest';
```

## Export Pattern

### 1. Re-export from each folder's index.ts
```typescript
// schema/index.ts
export * from './user';
export * from './userTypebox';
export * from './apiResponse';
export * from './apiResponseTypebox';

// types/index.ts
export * from './common';
```

### 2. Unified export from root index.ts (already configured)
```typescript
// index.ts
export * from './schema';
export * from './types';
```

## Usage

```typescript
// Import from other packages
import { 
  UserSchema,           // Zod schema
  UserTypeBox,          // TypeBox schema
  User,                 // Pure type
  UserRole 
} from '@vinxen/shared';

// Usage examples
const validateWithZod = UserSchema.parse(data);
const validateWithTypeBox = Value.Check(UserTypeBox, data);
```

## Best Practices

### ✅ Correct Usage
```typescript
// Default is Zod
export const UserSchema = z.object({...});

// Other libraries with suffix
export const UserTypeBox = Type.Object({...});
export const UserYup = yup.object({...});
```

### ❌ Incorrect Usage
```typescript
// Missing library name in filename
// In userTypebox.ts file but:
export const UserSchema = Type.Object({...}); // Causes confusion

// Pure types in schema folder
export interface User {...} // Should move to types/ folder
```

## Checklist

- [ ] Choose appropriate folder (`schema/` vs `types/`)
- [ ] Follow filename rules (library name suffix)
- [ ] Follow export naming conventions
- [ ] Add re-export to folder's index.ts
- [ ] Test import from other packages