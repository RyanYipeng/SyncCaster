# Implementation Plan

- [x] 1. Extend Account data model with status fields





  - [x] 1.1 Add AccountStatus enum and new fields to Account interface in packages/core


    - Add `status`, `lastCheckAt`, `lastError`, `consecutiveFailures` fields
    - Export AccountStatus enum
    - _Requirements: 5.1, 5.4_
  - [x] 1.2 Write property test for status persistence round-trip


    - **Property 5: Status Persistence Round-trip**
    - **Validates: Requirements 5.1, 5.4**

- [x] 2. Implement Cookie detection fallback in platform-api.ts





  - [x] 2.1 Add Cookie detection configuration for all 12 platforms


    - Define COOKIE_CONFIGS with domain and sessionCookies for each platform
    - _Requirements: 1.2, 1.5, 6.2_
  - [x] 2.2 Implement detectViaCookies helper function


    - Use chrome.cookies.getAll to check session cookies
    - Return UserInfo with detectionMethod: 'cookie'
    - _Requirements: 1.2_
  - [x] 2.3 Write property test for Cookie detection correctness


    - **Property 2: Cookie Detection Correctness**
    - **Validates: Requirements 1.2**
  - [x] 2.4 Integrate Cookie fallback into each platform's fetchUserInfo


    - Call detectViaCookies when primary API fails with retryable error
    - Skip fallback for 401/403 responses
    - _Requirements: 1.1, 1.3, 1.4, 6.3_
  - [x] 2.5 Write property test for detection fallback behavior


    - **Property 1: Detection Fallback Behavior**
    - **Validates: Requirements 1.1, 1.3, 1.4**
  - [x] 2.6 Write property test for fallback execution order


    - **Property 6: Fallback Execution Order**
    - **Validates: Requirements 6.3, 6.4**

- [x] 3. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend account-service.ts with status management





  - [x] 4.1 Add updateAccountStatus method


    - Update status, lastCheckAt, lastError in database
    - Handle consecutiveFailures increment/reset
    - _Requirements: 5.1, 5.4_
  - [x] 4.2 Modify refreshAccount to update status fields


    - Set status to ACTIVE on success, ERROR on retryable failure, EXPIRED on logout
    - Update lastCheckAt timestamp
    - Increment consecutiveFailures on failure, reset on success
    - _Requirements: 2.1, 2.4, 2.5_
  - [x] 4.3 Write property test for status preservation on retryable errors


    - **Property 3: Status Preservation on Retryable Errors**
    - **Validates: Requirements 2.1, 2.5**
  - [x] 4.4 Write property test for consecutive failure escalation

    - **Property 4: Consecutive Failure Escalation**
    - **Validates: Requirements 2.4**
  - [x] 4.5 Modify refreshAllAccountsFast to update status fields


    - Apply same status update logic as refreshAccount
    - Return updated accounts with status information
    - _Requirements: 2.1, 2.4, 2.5_

- [x] 5. Implement re-login flow in account-service.ts





  - [x] 5.1 Add reloginAccount method


    - Open platform login page in new tab
    - Poll for login success using existing checkLoginInTab
    - Update account status to ACTIVE on success
    - Close tab and return updated account
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [x] 5.2 Write property test for re-login status recovery


    - **Property 7: Re-login Status Recovery**
    - **Validates: Requirements 4.3**
  - [x] 5.3 Add message handler for RELOGIN_ACCOUNT in background.ts


    - Handle chrome.runtime.sendMessage from UI
    - Call AccountService.reloginAccount
    - _Requirements: 4.2_

- [x] 6. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update Accounts.vue UI with status indicators






  - [x] 7.1 Add status tag display logic

    - Show red "已失效" tag for EXPIRED status
    - Show yellow "检测异常" tag for ERROR status
    - Show loading indicator for CHECKING status
    - Add tooltip with lastError on hover
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 7.2 Add warning badge on avatar for expired accounts


    - Use n-badge component with dot indicator
    - _Requirements: 3.2_

  - [x] 7.3 Add conditional re-login button

    - Show "重新登录" button for EXPIRED accounts
    - Show "刷新" button for other statuses
    - _Requirements: 4.1_
  - [x] 7.4 Implement reloginAccount function


    - Send RELOGIN_ACCOUNT message to background
    - Show loading message during login
    - Handle success/failure responses
    - _Requirements: 4.2, 4.4, 4.5_

  - [x] 7.5 Display lastError in account footer

    - Show error message below account meta info
    - Style with red/yellow color based on status
    - _Requirements: 5.3_

  - [x] 7.6 Update refreshAllAccounts to handle new status fields

    - Update local accounts array with returned status
    - Improve error message display based on errorType
    - _Requirements: 2.2, 2.3_

- [x] 8. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

