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

### 问题三：账号失效后的管理与交互优化 📋 待实施

**建议方案**（已在文档中详细描述，可按需实施）：

1. **账号状态模型扩展**：
   ```typescript
   enum AccountStatus {
     ACTIVE = 'active',     // 正常
     EXPIRED = 'expired',   // 已失效
     CHECKING = 'checking', // 检测中
     ERROR = 'error',       // 检测异常（临时）
   }
   ```

2. **UI 状态标记**：
   - 失效账号显示红色标签
   - 临时错误显示黄色标签
   - 提供"重新登录"按钮

3. **重新登录流程**：
   - 打开平台登录页面
   - 轮询检测登录状态
   - 登录成功后自动恢复账号状态

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

### `apps/extension/src/ui/options/views/Accounts.vue`

1. `refreshAllAccounts` 区分显示真正失效和临时错误的账号

---

## 测试建议

1. **一键刷新测试**：
   - 确认不会弹出任何新页面
   - 确认微信公众号能正确检测登录状态

2. **错误类型测试**：
   - 模拟网络错误，确认显示为"临时问题"
   - 模拟 404 响应，确认不直接判定为登录失效
   - 真正登出后，确认显示为"登录已失效"

3. **各平台测试**：
   - 逐一测试 12 个平台的登录检测
   - 确认 JSON 解析错误不再出现
