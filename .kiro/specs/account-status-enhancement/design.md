# Design Document

## Overview

本设计文档描述账号登录状态检测机制增强和失效账号管理交互优化的技术实现方案。核心目标是：

1. **提升检测准确性**：通过多重检测机制（API + Cookie）降低误判率
2. **增强容错性**：区分临时错误和真正失效，避免因接口波动导致大规模误判
3. **优化用户体验**：提供清晰的状态标记和便捷的重新登录流程

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Accounts.vue (UI)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Status Tags │  │ Re-login    │  │ Error Messages          │  │
│  │ (已失效/异常)│  │ Button      │  │ (Tooltip/Footer)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    account-service.ts                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ refreshAllAccountsFast() / refreshAccount()              │    │
│  │ - Orchestrates detection                                 │    │
│  │ - Updates account status in DB                           │    │
│  │ - Handles re-login flow                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     platform-api.ts                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ PlatformDetector                                         │    │
│  │ - Primary: API detection                                 │    │
│  │ - Fallback: Cookie detection                             │    │
│  │ - Error classification (LOGGED_OUT / API_ERROR / etc.)   │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Platform Configs (per-platform detection strategies)     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Account Status Model Extension

```typescript
// packages/core/src/db/schema.ts (扩展)
export enum AccountStatus {
  ACTIVE = 'active',           // 正常
  EXPIRED = 'expired',         // 已失效（确认登出）
  ERROR = 'error',             // 检测异常（临时问题）
  CHECKING = 'checking',       // 检测中
}

export interface Account {
  id: string;
  platform: string;
  nickname: string;
  avatar?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, any>;
  
  // 新增字段
  status?: AccountStatus;      // 账号状态
  lastCheckAt?: number;        // 最后检测时间
  lastError?: string;          // 最后错误信息
  consecutiveFailures?: number; // 连续失败次数
}
```

### 2. Platform Detection Configuration

```typescript
// apps/extension/src/background/platform-api.ts (扩展)
interface PlatformDetectionConfig {
  id: string;
  name: string;
  // 主要检测方法
  primaryDetection: () => Promise<UserInfo>;
  // Cookie 检测配置（备用）
  cookieDetection?: {
    domain: string;
    sessionCookies: string[];  // 表示有效会话的 Cookie 名称
  };
  // 是否跳过 Cookie 检测（某些平台不适用）
  skipCookieFallback?: boolean;
}
```

### 3. Enhanced UserInfo Interface

```typescript
// apps/extension/src/background/platform-api.ts (已有，确认)
export interface UserInfo {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatar?: string;
  platform: string;
  error?: string;
  errorType?: AuthErrorType;
  retryable?: boolean;
  meta?: { ... };
  
  // 新增
  detectionMethod?: 'api' | 'cookie';  // 检测方式
}
```

### 4. Account Service Extensions

```typescript
// apps/extension/src/background/account-service.ts (扩展)
export class AccountService {
  // 新增：重新登录流程
  static async reloginAccount(account: Account): Promise<Account>;
  
  // 新增：更新账号状态
  static async updateAccountStatus(
    accountId: string, 
    status: AccountStatus, 
    error?: string
  ): Promise<void>;
  
  // 修改：刷新时更新状态字段
  static async refreshAccount(account: Account): Promise<Account>;
}
```

## Data Models

### Account Status State Machine

```
                    ┌──────────────┐
                    │   ACTIVE     │
                    │  (正常)      │
                    └──────┬───────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │   CHECKING   │ │    ERROR     │ │   EXPIRED    │
    │  (检测中)    │ │  (检测异常)  │ │  (已失效)    │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │               │               │
           │    成功       │   3次失败     │  重新登录
           └───────────────┼───────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   ACTIVE     │
                    └──────────────┘
```

### Database Schema Changes

Account 表新增字段：
- `status`: TEXT (默认 'active')
- `lastCheckAt`: INTEGER (时间戳)
- `lastError`: TEXT (可空)
- `consecutiveFailures`: INTEGER (默认 0)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Detection Fallback Behavior
*For any* platform with Cookie detection configured, when the primary API returns a 404 or 500+ error, the system should attempt Cookie detection before determining the final status. When API returns 401/403, no fallback should be attempted and status should be EXPIRED.
**Validates: Requirements 1.1, 1.3, 1.4**

### Property 2: Cookie Detection Correctness
*For any* set of cookies for a platform, the Cookie detection should return loggedIn=true if and only if at least one of the configured session cookies exists with a non-empty value.
**Validates: Requirements 1.2**

### Property 3: Status Preservation on Retryable Errors
*For any* account with ACTIVE status, when a refresh fails with a retryable error (errorType !== LOGGED_OUT), the account status should change to ERROR (not EXPIRED) and consecutiveFailures should increment.
**Validates: Requirements 2.1, 2.5**

### Property 4: Consecutive Failure Escalation
*For any* account, when consecutiveFailures reaches 3 with retryable errors, the status should escalate to require user attention (displayed prominently).
**Validates: Requirements 2.4**

### Property 5: Status Persistence Round-trip
*For any* account status update, persisting to database and then loading should return the same status, lastCheckAt, and lastError values.
**Validates: Requirements 5.1, 5.4**

### Property 6: Fallback Execution Order
*For any* platform with multiple detection methods configured, when the primary method fails with a retryable error, fallback methods should be executed in the configured order until one succeeds or all fail.
**Validates: Requirements 6.3, 6.4**

### Property 7: Re-login Status Recovery
*For any* expired account, after successful re-login detection, the account status should change to ACTIVE, consecutiveFailures should reset to 0, and lastError should be cleared.
**Validates: Requirements 4.3**

## Error Handling

### Error Classification Strategy

| HTTP Status | Content Type | Error Type | Retryable | Action |
|-------------|--------------|------------|-----------|--------|
| 401, 403 | Any | LOGGED_OUT | No | Mark EXPIRED |
| 404 | Any | API_ERROR | Yes | Try Cookie fallback |
| 429 | Any | RATE_LIMITED | Yes | Try Cookie fallback |
| 500+ | Any | API_ERROR | Yes | Try Cookie fallback |
| 200 | HTML (login page) | LOGGED_OUT | No | Mark EXPIRED |
| 200 | HTML (other) | API_ERROR | Yes | Try Cookie fallback |
| 200 | JSON (success) | - | - | Mark ACTIVE |
| Network Error | - | NETWORK_ERROR | Yes | Try Cookie fallback |

### Cookie Fallback Configuration

```typescript
const COOKIE_CONFIGS: Record<string, CookieDetectionConfig> = {
  'juejin': {
    domain: '.juejin.cn',
    sessionCookies: ['sessionid', 'sessionid_ss'],
  },
  'csdn': {
    domain: '.csdn.net',
    sessionCookies: ['UserName', 'UserToken'],
  },
  'zhihu': {
    domain: '.zhihu.com',
    sessionCookies: ['z_c0', 'd_c0'],
  },
  'bilibili': {
    domain: '.bilibili.com',
    sessionCookies: ['SESSDATA', 'bili_jct'],
  },
  'jianshu': {
    domain: '.jianshu.com',
    sessionCookies: ['remember_user_token'],
  },
  'cnblogs': {
    domain: '.cnblogs.com',
    sessionCookies: ['.CNBlogsCookie'],
  },
  '51cto': {
    domain: '.51cto.com',
    sessionCookies: ['sid', 'uc_token'],
  },
  'tencent-cloud': {
    domain: '.cloud.tencent.com',
    sessionCookies: ['uin', 'skey'],
  },
  'aliyun': {
    domain: '.aliyun.com',
    sessionCookies: ['login_aliyunid_pk', 'login_aliyunid'],
  },
  'segmentfault': {
    domain: '.segmentfault.com',
    sessionCookies: ['PHPSESSID', 'sf_remember'],
  },
  'oschina': {
    domain: '.oschina.net',
    sessionCookies: ['oscid'],
  },
  'wechat': {
    domain: 'mp.weixin.qq.com',
    sessionCookies: ['slave_sid', 'data_ticket', 'bizuin'],
  },
};
```

## Testing Strategy

### Unit Testing

使用 Vitest 进行单元测试：

1. **platform-api.ts 测试**
   - 测试各平台 API 响应解析
   - 测试 Cookie 检测逻辑
   - 测试错误分类逻辑

2. **account-service.ts 测试**
   - 测试状态更新逻辑
   - 测试重新登录流程
   - 测试连续失败计数

### Property-Based Testing

使用 fast-check 进行属性测试：

1. **Property 1-2**: 检测回退行为测试
2. **Property 3-4**: 状态管理测试
3. **Property 5**: 持久化往返测试
4. **Property 6**: 回退执行顺序测试
5. **Property 7**: 重新登录恢复测试

### Integration Testing

1. 模拟各平台 API 响应
2. 测试完整的刷新流程
3. 测试 UI 状态显示

