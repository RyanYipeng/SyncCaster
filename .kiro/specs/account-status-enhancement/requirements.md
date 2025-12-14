# Requirements Document

## Introduction

本需求文档描述账号登录状态检测机制的增强和失效账号管理交互优化功能。目标是提升账号状态检测的准确性与容错性，避免因外部接口不稳定而影响整体用户体验，同时为失效账号提供清晰的状态反馈和便捷的重新登录流程。

## Glossary

- **Account**: 用户在各内容平台（如掘金、CSDN、知乎等）绑定的账号信息
- **AccountStatus**: 账号的登录状态，包括正常、已失效、检测异常、检测中等
- **Platform API**: 各内容平台提供的用户信息接口
- **Cookie Detection**: 通过检查浏览器 Cookie 判断登录状态的备用方案
- **Fallback Strategy**: 当主要检测方式失败时采用的备用检测策略
- **AuthErrorType**: 错误类型枚举，用于区分不同类型的检测失败原因

## Requirements

### Requirement 1

**User Story:** As a user, I want the system to use multiple detection methods when checking account login status, so that I can get accurate results even when platform APIs are unstable.

#### Acceptance Criteria

1. WHEN the primary API returns a 404 or 500+ error THEN the System SHALL attempt Cookie-based detection as a fallback before marking the account as failed
2. WHEN Cookie detection is used as fallback THEN the System SHALL check for platform-specific session cookies to determine login status
3. WHEN both API and Cookie detection fail THEN the System SHALL mark the error as retryable and display it as a temporary issue
4. WHEN the API returns a clear logout response (401/403 or explicit logout message) THEN the System SHALL mark the account as definitively expired without fallback attempts
5. WHERE Cookie detection is configured for a platform THEN the System SHALL define the specific cookie names that indicate a valid session

### Requirement 2

**User Story:** As a user, I want the system to clearly distinguish between "account truly expired" and "temporary detection failure", so that I don't unnecessarily re-login when the issue is just a temporary API problem.

#### Acceptance Criteria

1. WHEN an account check fails with a retryable error THEN the System SHALL preserve the account's previous status and mark it with a temporary error indicator
2. WHEN displaying failed accounts after refresh THEN the System SHALL show different visual indicators for expired accounts versus temporarily failed accounts
3. WHEN a temporary error occurs THEN the System SHALL display a message suggesting the user retry later rather than re-login
4. WHEN the same account fails detection 3 consecutive times with retryable errors THEN the System SHALL escalate the status to require user attention
5. WHEN an account has a temporary error status THEN the System SHALL automatically retry detection on the next refresh operation

### Requirement 3

**User Story:** As a user, I want to see clear status indicators for each account in the account management page, so that I can quickly identify which accounts need attention.

#### Acceptance Criteria

1. WHEN an account is in normal status THEN the System SHALL display no special indicator or a green checkmark
2. WHEN an account is expired THEN the System SHALL display a red "已失效" tag and a warning icon on the avatar
3. WHEN an account has a temporary error THEN the System SHALL display a yellow "检测异常" tag
4. WHEN an account is being checked THEN the System SHALL display a loading indicator
5. WHEN hovering over a status tag THEN the System SHALL show a tooltip with the specific error message

### Requirement 4

**User Story:** As a user, I want to have a convenient re-login button for expired accounts, so that I can quickly restore account access without navigating away.

#### Acceptance Criteria

1. WHEN an account is marked as expired THEN the System SHALL display a "重新登录" button in place of the "刷新" button
2. WHEN the user clicks "重新登录" THEN the System SHALL open the platform's login page in a new tab
3. WHEN the user completes login in the opened tab THEN the System SHALL automatically detect the login success and update the account status
4. WHEN login is detected successfully THEN the System SHALL close the login tab and show a success message
5. WHEN the login tab is closed without successful login THEN the System SHALL show a message indicating login was not completed

### Requirement 5

**User Story:** As a user, I want the account status to persist across sessions, so that I can see which accounts had issues even after reopening the extension.

#### Acceptance Criteria

1. WHEN an account's status changes THEN the System SHALL persist the new status to the database
2. WHEN the account management page loads THEN the System SHALL display the persisted status for each account
3. WHEN an account has a lastError value THEN the System SHALL display it in the account's footer area
4. WHEN an account's status is updated THEN the System SHALL also update the lastCheckAt timestamp
5. WHEN displaying account information THEN the System SHALL show the last successful check time if available

### Requirement 6

**User Story:** As a developer, I want the system to have configurable fallback detection strategies per platform, so that I can optimize detection reliability for each platform's characteristics.

#### Acceptance Criteria

1. WHEN defining a platform's detection configuration THEN the System SHALL support specifying multiple detection methods in priority order
2. WHEN a platform has Cookie detection configured THEN the System SHALL specify which cookies indicate valid login
3. WHEN a platform's primary API fails THEN the System SHALL execute fallback methods in the configured order
4. WHEN all configured detection methods fail THEN the System SHALL aggregate the errors and determine the final status
5. WHERE a platform requires special handling THEN the System SHALL support platform-specific detection logic

