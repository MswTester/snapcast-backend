# Shared 패키지 작성 가이드

## 디렉토리 구조

```
packages/shared/
├── schema/
│   ├── user.ts          # Zod 스키마 (기본)
│   ├── userTypebox.ts   # TypeBox 스키마
│   ├── userYup.ts       # Yup 스키마
│   └── index.ts
├── types/
│   ├── common.ts        # 순수 TS 타입
│   └── index.ts
└── index.ts
```

## 파일 분류 규칙

### 📁 `schema/` - 런타임 검증용 스키마
- **기본**: Zod 사용 → 파일명 그대로 (`user.ts`)
- **다른 라이브러리**: 파일명 뒤에 라이브러리명 추가 (`userTypebox.ts`, `userYup.ts`)

### 📁 `types/` - 컴파일 타임 타입
- interface, type, enum 등 순수 TypeScript 타입

## 네이밍 규칙

### Schema 파일명
```typescript
// Zod (기본)
user.ts
apiResponse.ts

// 다른 라이브러리
userTypebox.ts
apiResponseYup.ts
```

### Export 네이밍
```typescript
// Zod - 기본 이름
export const UserSchema = z.object({...});

// TypeBox - 접미사 추가
export const UserTypeBox = Type.Object({...});

// Yup - 접미사 추가  
export const UserYup = yup.object({...});
```

## 실제 예시

### Zod 스키마 (기본)
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

### TypeBox 스키마
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

### 순수 타입
```typescript
// types/common.ts
export interface User {
  id: string;
  email: string;
  name: string;
}

export type UserRole = 'admin' | 'user' | 'guest';
```

## Export 패턴

### 1. 각 폴더의 index.ts에서 re-export
```typescript
// schema/index.ts
export * from './user';
export * from './userTypebox';
export * from './apiResponse';
export * from './apiResponseTypebox';

// types/index.ts
export * from './common';
```

### 2. 루트 index.ts에서 통합 (되어 있음)
```typescript
// index.ts
export * from './schema';
export * from './types';
```

## 사용 방법

```typescript
// 다른 패키지에서 import
import { 
  UserSchema,           // Zod 스키마
  UserTypeBox,          // TypeBox 스키마
  User,                 // 순수 타입
  UserRole 
} from '@vinxen/shared';

// 사용 예시
const validateWithZod = UserSchema.parse(data);
const validateWithTypeBox = Value.Check(UserTypeBox, data);
```

## 주의사항

### ✅ 올바른 사용
```typescript
// 기본은 Zod
export const UserSchema = z.object({...});

// 다른 라이브러리는 접미사 추가
export const UserTypeBox = Type.Object({...});
export const UserYup = yup.object({...});
```

### ❌ 잘못된 사용
```typescript
// 파일명에 라이브러리명 없음
// userTypebox.ts 파일인데
export const UserSchema = Type.Object({...}); // 혼동 유발

// 순수 타입을 schema 폴더에
export interface User {...} // types/ 폴더로 이동
```

## 체크리스트

- [ ] 적절한 폴더 선택 (`schema/` vs `types/`)
- [ ] 파일명 규칙 준수 (라이브러리명 접미사)
- [ ] Export 네이밍 규칙 준수
- [ ] 각 폴더 index.ts에 re-export 추가
- [ ] 다른 패키지에서 import 테스트