# 账号登录检测优化

## 问题描述

CSDN 等平台登录时，用户需要等待很长时间（几十秒）插件才能识别到登录成功。

### 根本原因

1. 原有轮询机制依赖 `checkLoginInTab`，需要向 content script 发送消息
2. CSDN 登录过程会跳转多个页面，每次跳转都需要重新注入 content script
3. 首次轮询延迟 3 秒，轮询间隔 2 秒
4. `waitForTabLoad` 等待页面完全加载，但登录页面跳转频繁

## 优化方案

### 1. 优先使用直接 API 检测

对于支持直接 API 的平台（如 CSDN），在轮询时优先使用 `fetchPlatformUserInfo` 而不是 `checkLoginInTab`：

- 直接 API 检测通过 Cookie 和 API 调用判断登录状态
- 不依赖页面加载状态，不需要 content script
- 响应更快，更稳定

### 2. 减少轮询延迟

- 首次轮询延迟：3 秒 → 1 秒
- 轮询间隔（直接 API）：2 秒 → 1 秒

### 3. 移除不必要的等待

- 移除 `waitForTabLoad` 调用（对于直接 API 检测不需要等待页面加载）
- 登录页面只需要打开，不需要等待完全加载

## 影响的方法

1. `AccountService.addAccount` - 引导登录添加账号
2. `AccountService.reloginAccount` - 重新登录账号

## 预期效果

- CSDN 等支持直接 API 的平台：登录成功后 1-2 秒内识别
- 微信公众号等不支持直接 API 的平台：保持原有行为

## 相关文件

- `apps/extension/src/background/account-service.ts`
- `apps/extension/src/background/platform-api.ts`
