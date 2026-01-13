# 账号刷新功能改进方案

> 本文档记录了账号刷新功能的问题分析和已实施的改进方案。

## 已完成的改进

### 问题一：一键刷新触发页面弹出 ✅ 已修复

**根因**：微信公众号平台没有公开 API，原实现会通过 `chrome.tabs.create` 打开标签页检测登录状态。

**解决方案**：在 `platform-api.ts` 中为微信公众号实现了 Cookie 检测方案：
- 使用 `chrome.cookies.getAll` 检查关键 Cookie（slave_sid, data_ticket, bizuin）
- 使用 `redirect: 'manual'` 阻止重定向
- 检查响应内容判断是否为登录页面
- 现在所有平台都支持直接 API 调用，无需打开标签页

### 问题二：登录失效判断逻辑不准确 ✅ 已修复

**根因**：
1. HTTP 状态码误判：直接将 HTTP 404/400 等错误码判定为"登录失效"
2. JSON 解析错误：某些平台返回 HTML 被当作 JSON 解析
3. 网络/风控误判：临时问题被误判为登录失效

**解决方案**：

1. **新增错误类型枚举** (`AuthErrorType`)：
   - `LOGGED_OUT`: 确认已登出
   - `API_ERROR`: API 调用失败（可能是临时问题）
   - `NETWORK_ERROR`: 网络错误
   - `RATE_LIMITED`: 被限流
   - `UNKNOWN`: 未知错误

2. **新增 `retryable` 字段**：标识错误是否可重试

3. **智能响应解析** (`parseApiResponse`)：
   - 401/403 → 确认登录失效
   - 429 → 限流，可重试
   - 500+ → 服务端错误，可重试
   - 404 → API 可能变更，可重试（不直接判定为登录失效）
   - 400 → 进一步分析响应内容
   - HTML 响应 → 检查是否为登录页面

4. **重试机制**：`fetchWithCookies` 支持自动重试

5. **UI 改进**：区分显示真正失效和临时错误的账号

### 问题三：启动时检测延迟 ✅ 已修复（v2.0）

**根因**：启动时对所有账号调用 API 检测，导致明显的延迟。

**解决方案**：实现三层检测策略和懒加载机制：

```
┌─────────────────────────────────────────────────────────────┐
│                    Background Service                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ API 检测    │ →  │ Cookie 回退 │ →  │ 标签页检测  │     │
│  │ (首选)      │    │ (备用)      │    │ (最后手段)  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

1. **快速状态检测**：启动时只检测 Cookie 存在性，不调用 API
2. **智能刷新策略**：根据缓存时间和 Cookie 状态决定是否刷新
3. **懒加载检测**：用户选择平台时才进行完整检测

---

## v2.0 新增功能

### 1. 快速状态检测

启动时只检测 Cookie 存在性，不调用 API：

```typescript
// 快速检测 - 仅检测 Cookie
const result = await AccountService.quickStatusCheck(account);
// 返回: { hasValidCookies, isExpiringSoon, cookieExpiresAt }

// 批量快速检测
const results = await AccountService.quickStatusCheckAll(accounts);
```

### 2. 智能刷新策略

根据以下条件决定是否需要刷新：

1. 状态不是 ACTIVE
2. Cookie 即将过期（24小时内）
3. 距离上次检测超过 30 分钟
4. Cookie 不存在

```typescript
// 判断是否需要刷新
const { needsRefresh, reason } = await AccountService.shouldRefreshAccount(account, {
  maxAge: 30 * 60 * 1000, // 30 分钟缓存
});

// 智能刷新 - 自动判断是否需要刷新
const result = await AccountService.smartRefreshAccount(account, {
  maxAge: 30 * 60 * 1000,
});
// 返回: { account, refreshed, reason }
```

### 3. 懒加载检测

用户选择平台时才进行检测：

```typescript
// 懒加载检测 - 用户触发时才检测
const result = await AccountService.lazyCheckAccount(account, forceCheck);
// 返回: { needsRelogin, isExpiringSoon, account }
```

### 4. Cookie 过期预警

- 检测 Cookie 最早过期时间
- 24小时内过期显示"即将过期"标签
- 提供"重新登录"按钮

### 5. 新增消息类型

| 消息类型 | 说明 |
|----------|------|
| `QUICK_STATUS_CHECK` | 快速状态检测 |
| `QUICK_STATUS_CHECK_ALL` | 批量快速状态检测 |
| `SHOULD_REFRESH_ACCOUNT` | 判断是否需要刷新 |
| `SMART_REFRESH_ACCOUNT` | 智能刷新账号 |

---

## 代码变更清单

### `apps/extension/src/background/platform-api.ts`

1. 新增 `AuthErrorType` 枚举
2. `UserInfo` 接口新增 `errorType` 和 `retryable` 字段
3. `fetchWithCookies` 支持重试机制
4. 新增 `parseApiResponse` 智能响应解析函数
5. 所有平台 API 改用 `parseApiResponse` 处理响应
6. 微信公众号改用 Cookie 检测方案
7. `supportDirectApi` 现在对所有平台返回 true

### `apps/extension/src/background/account-service.ts`

1. `refreshAllAccountsFast` 返回值新增 `errorType` 和 `retryable` 字段
2. 新增 `quickStatusCheck` 快速状态检测方法
3. 新增 `quickStatusCheckAll` 批量快速状态检测方法
4. 新增 `shouldRefreshAccount` 判断是否需要刷新方法
5. 新增 `smartRefreshAccount` 智能刷新方法

### `apps/extension/src/background/index.ts`

1. 新增 `QUICK_STATUS_CHECK` 消息处理
2. 新增 `QUICK_STATUS_CHECK_ALL` 消息处理
3. 新增 `SHOULD_REFRESH_ACCOUNT` 消息处理
4. 新增 `SMART_REFRESH_ACCOUNT` 消息处理

### `apps/extension/src/ui/options/views/Accounts.vue`

1. `refreshAllAccounts` 区分显示真正失效和临时错误的账号
2. 新增 `quickStatusCheckOnStartup` 启动时快速检测
3. 新增 `smartRefreshAccount` 智能刷新功能

---

## 测试建议

1. **一键刷新测试**：
   - 确认不会弹出任何新页面
   - 确认微信公众号能正确检测登录状态

2. **错误类型测试**：
   - 模拟网络错误，确认显示为"临时问题"
   - 模拟 404 响应，确认不直接判定为登录失效
   - 真正登出后，确认显示为"登录已失效"

3. **启动时检测测试**：
   - 确认启动时不会调用 API
   - 确认 Cookie 不存在时显示提示
   - 确认 Cookie 即将过期时显示提示

4. **智能刷新测试**：
   - 确认 30 分钟内不会重复刷新
   - 确认 Cookie 即将过期时会刷新
   - 确认状态不是 ACTIVE 时会刷新

5. **各平台测试**：
   - 逐一测试 12 个平台的登录检测
   - 确认 JSON 解析错误不再出现
