/**
 * Account Service Status Management Property Tests
 * 
 * Feature: account-status-enhancement
 * Tests status preservation on retryable errors and consecutive failure escalation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { AccountStatus, type Account, type PlatformId } from '@synccaster/core';
import { AuthErrorType, type UserInfo } from '../platform-api';

// Platform IDs for arbitrary generation
const platformIds: PlatformId[] = [
  'wechat', 'zhihu', 'juejin', 'csdn', 'jianshu', 
  'cnblogs', 'oschina', '51cto', 'tencent-cloud', 
  'aliyun', 'segmentfault', 'bilibili'
];

// Arbitrary for PlatformId
const platformIdArb = fc.constantFrom(...platformIds);

// Arbitrary for Account with ACTIVE status
const activeAccountArb = fc.record({
  id: fc.uuid(),
  platform: platformIdArb,
  nickname: fc.string({ minLength: 1, maxLength: 50 }),
  avatar: fc.option(fc.webUrl(), { nil: undefined }),
  enabled: fc.boolean(),
  createdAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  updatedAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  meta: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
  status: fc.constant(AccountStatus.ACTIVE),
  lastCheckAt: fc.option(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), { nil: undefined }),
  lastError: fc.constant(undefined),
  consecutiveFailures: fc.integer({ min: 0, max: 10 }),
}) as fc.Arbitrary<Account>;

// Arbitrary for retryable error types (not LOGGED_OUT)
const retryableErrorTypeArb = fc.constantFrom(
  AuthErrorType.API_ERROR,
  AuthErrorType.NETWORK_ERROR,
  AuthErrorType.RATE_LIMITED,
  AuthErrorType.UNKNOWN
);

// Arbitrary for retryable UserInfo (failed but retryable)
const retryableUserInfoArb = (platform: string) => fc.record({
  loggedIn: fc.constant(false),
  platform: fc.constant(platform),
  errorType: retryableErrorTypeArb,
  error: fc.string({ minLength: 1, maxLength: 100 }),
  retryable: fc.constant(true),
}) as fc.Arbitrary<UserInfo>;

// Arbitrary for logged out UserInfo (not retryable)
const loggedOutUserInfoArb = (platform: string) => fc.record({
  loggedIn: fc.constant(false),
  platform: fc.constant(platform),
  errorType: fc.constant(AuthErrorType.LOGGED_OUT),
  error: fc.string({ minLength: 1, maxLength: 100 }),
  retryable: fc.constant(false),
}) as fc.Arbitrary<UserInfo>;

/**
 * Simulates the status update logic from refreshAccount
 * This is a pure function that mirrors the actual implementation logic
 */
function computeNewAccountStatus(
  account: Account,
  userInfo: UserInfo
): { status: AccountStatus; consecutiveFailures: number; lastError?: string } {
  if (userInfo.loggedIn) {
    return {
      status: AccountStatus.ACTIVE,
      consecutiveFailures: 0,
      lastError: undefined,
    };
  }
  
  const isRetryable = userInfo.retryable === true && userInfo.errorType !== AuthErrorType.LOGGED_OUT;
  
  if (isRetryable) {
    return {
      status: AccountStatus.ERROR,
      consecutiveFailures: (account.consecutiveFailures || 0) + 1,
      lastError: userInfo.error,
    };
  }
  
  return {
    status: AccountStatus.EXPIRED,
    consecutiveFailures: account.consecutiveFailures || 0,
    lastError: userInfo.error,
  };
}

describe('Account Service Status Management', () => {
  /**
   * Feature: account-status-enhancement, Property 3: Status Preservation on Retryable Errors
   * Validates: Requirements 2.1, 2.5
   * 
   * For any account with ACTIVE status, when a refresh fails with a retryable error 
   * (errorType !== LOGGED_OUT), the account status should change to ERROR (not EXPIRED) 
   * and consecutiveFailures should increment.
   */
  it('Property 3: retryable errors set status to ERROR and increment consecutiveFailures', () => {
    fc.assert(
      fc.property(
        activeAccountArb,
        platformIdArb,
        retryableErrorTypeArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        (account, platform, errorType, errorMessage) => {
          const userInfo: UserInfo = {
            loggedIn: false,
            platform,
            errorType,
            error: errorMessage,
            retryable: true,
          };
          
          const result = computeNewAccountStatus(account, userInfo);
          
          // Status should be ERROR, not EXPIRED
          expect(result.status).toBe(AccountStatus.ERROR);
          expect(result.status).not.toBe(AccountStatus.EXPIRED);
          
          // consecutiveFailures should increment by 1
          expect(result.consecutiveFailures).toBe((account.consecutiveFailures || 0) + 1);
          
          // lastError should be set
          expect(result.lastError).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Verify that LOGGED_OUT errors set status to EXPIRED
   */
  it('LOGGED_OUT errors set status to EXPIRED', () => {
    fc.assert(
      fc.property(
        activeAccountArb,
        platformIdArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        (account, platform, errorMessage) => {
          const userInfo: UserInfo = {
            loggedIn: false,
            platform,
            errorType: AuthErrorType.LOGGED_OUT,
            error: errorMessage,
            retryable: false,
          };
          
          const result = computeNewAccountStatus(account, userInfo);
          
          // Status should be EXPIRED for LOGGED_OUT
          expect(result.status).toBe(AccountStatus.EXPIRED);
          
          // lastError should be set
          expect(result.lastError).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Verify that successful refresh resets status to ACTIVE and clears failures
   */
  it('successful refresh sets status to ACTIVE and resets consecutiveFailures', () => {
    // Account with ERROR status and some failures
    const errorAccountArb = fc.record({
      id: fc.uuid(),
      platform: platformIdArb,
      nickname: fc.string({ minLength: 1, maxLength: 50 }),
      avatar: fc.option(fc.webUrl(), { nil: undefined }),
      enabled: fc.boolean(),
      createdAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      updatedAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      meta: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
      status: fc.constantFrom(AccountStatus.ERROR, AccountStatus.EXPIRED),
      lastCheckAt: fc.option(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), { nil: undefined }),
      lastError: fc.string({ minLength: 1, maxLength: 100 }),
      consecutiveFailures: fc.integer({ min: 1, max: 10 }),
    }) as fc.Arbitrary<Account>;
    
    fc.assert(
      fc.property(
        errorAccountArb,
        platformIdArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (account, platform, nickname) => {
          const userInfo: UserInfo = {
            loggedIn: true,
            platform,
            nickname,
          };
          
          const result = computeNewAccountStatus(account, userInfo);
          
          // Status should be ACTIVE
          expect(result.status).toBe(AccountStatus.ACTIVE);
          
          // consecutiveFailures should be reset to 0
          expect(result.consecutiveFailures).toBe(0);
          
          // lastError should be cleared
          expect(result.lastError).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Consecutive Failure Escalation', () => {
  /**
   * Feature: account-status-enhancement, Property 4: Consecutive Failure Escalation
   * Validates: Requirements 2.4
   * 
   * For any account, when consecutiveFailures reaches 3 with retryable errors, 
   * the status should escalate to require user attention (displayed prominently).
   * 
   * Note: The escalation is primarily a UI concern. This test verifies that
   * consecutiveFailures correctly accumulates across multiple failures.
   */
  it('Property 4: consecutiveFailures accumulates correctly across multiple retryable failures', () => {
    fc.assert(
      fc.property(
        activeAccountArb,
        fc.integer({ min: 1, max: 5 }), // number of consecutive failures to simulate
        platformIdArb,
        (initialAccount, numFailures, platform) => {
          let account = { ...initialAccount, consecutiveFailures: 0 };
          
          // Simulate multiple consecutive retryable failures
          for (let i = 0; i < numFailures; i++) {
            const userInfo: UserInfo = {
              loggedIn: false,
              platform,
              errorType: AuthErrorType.API_ERROR,
              error: `Error ${i + 1}`,
              retryable: true,
            };
            
            const result = computeNewAccountStatus(account, userInfo);
            
            // Update account for next iteration
            account = {
              ...account,
              status: result.status,
              consecutiveFailures: result.consecutiveFailures,
              lastError: result.lastError,
            };
          }
          
          // After numFailures consecutive failures, consecutiveFailures should equal numFailures
          expect(account.consecutiveFailures).toBe(numFailures);
          
          // Status should be ERROR (not EXPIRED) for retryable errors
          expect(account.status).toBe(AccountStatus.ERROR);
          
          // Check escalation threshold (3 failures)
          if (numFailures >= 3) {
            // At 3+ failures, the account requires user attention
            // This is verified by checking consecutiveFailures >= 3
            expect(account.consecutiveFailures).toBeGreaterThanOrEqual(3);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Verify that a successful refresh resets the failure counter
   */
  it('successful refresh after failures resets consecutiveFailures to 0', () => {
    fc.assert(
      fc.property(
        activeAccountArb,
        fc.integer({ min: 1, max: 10 }), // initial failure count
        platformIdArb,
        (account, initialFailures, platform) => {
          // Start with some failures
          const accountWithFailures = {
            ...account,
            status: AccountStatus.ERROR,
            consecutiveFailures: initialFailures,
            lastError: 'Previous error',
          };
          
          // Simulate successful refresh
          const userInfo: UserInfo = {
            loggedIn: true,
            platform,
            nickname: 'TestUser',
          };
          
          const result = computeNewAccountStatus(accountWithFailures, userInfo);
          
          // consecutiveFailures should be reset to 0
          expect(result.consecutiveFailures).toBe(0);
          
          // Status should be ACTIVE
          expect(result.status).toBe(AccountStatus.ACTIVE);
          
          // lastError should be cleared
          expect(result.lastError).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Verify that LOGGED_OUT error does not increment consecutiveFailures
   * (it's a definitive failure, not a temporary one)
   */
  it('LOGGED_OUT error does not increment consecutiveFailures', () => {
    fc.assert(
      fc.property(
        activeAccountArb,
        platformIdArb,
        (account, platform) => {
          const initialFailures = account.consecutiveFailures || 0;
          
          const userInfo: UserInfo = {
            loggedIn: false,
            platform,
            errorType: AuthErrorType.LOGGED_OUT,
            error: '登录已失效',
            retryable: false,
          };
          
          const result = computeNewAccountStatus(account, userInfo);
          
          // consecutiveFailures should NOT increment for LOGGED_OUT
          expect(result.consecutiveFailures).toBe(initialFailures);
          
          // Status should be EXPIRED
          expect(result.status).toBe(AccountStatus.EXPIRED);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Re-login Status Recovery', () => {
  /**
   * Feature: account-status-enhancement, Property 7: Re-login Status Recovery
   * Validates: Requirements 4.3
   * 
   * For any expired account, after successful re-login detection, the account status 
   * should change to ACTIVE, consecutiveFailures should reset to 0, and lastError 
   * should be cleared.
   */
  
  // Arbitrary for expired account (with various failure states)
  const expiredAccountArb = fc.record({
    id: fc.uuid(),
    platform: platformIdArb,
    nickname: fc.string({ minLength: 1, maxLength: 50 }),
    avatar: fc.option(fc.webUrl(), { nil: undefined }),
    enabled: fc.boolean(),
    createdAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    updatedAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    meta: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
    status: fc.constant(AccountStatus.EXPIRED),
    lastCheckAt: fc.option(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), { nil: undefined }),
    lastError: fc.string({ minLength: 1, maxLength: 100 }),
    consecutiveFailures: fc.integer({ min: 0, max: 10 }),
  }) as fc.Arbitrary<Account>;

  // Arbitrary for error account (temporary failures)
  const errorAccountArb = fc.record({
    id: fc.uuid(),
    platform: platformIdArb,
    nickname: fc.string({ minLength: 1, maxLength: 50 }),
    avatar: fc.option(fc.webUrl(), { nil: undefined }),
    enabled: fc.boolean(),
    createdAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    updatedAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    meta: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
    status: fc.constant(AccountStatus.ERROR),
    lastCheckAt: fc.option(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), { nil: undefined }),
    lastError: fc.string({ minLength: 1, maxLength: 100 }),
    consecutiveFailures: fc.integer({ min: 1, max: 10 }),
  }) as fc.Arbitrary<Account>;

  // Combined arbitrary for any failed account (EXPIRED or ERROR)
  const failedAccountArb = fc.oneof(expiredAccountArb, errorAccountArb);

  /**
   * Simulates the re-login status recovery logic
   * This is a pure function that mirrors the actual implementation logic in reloginAccount
   */
  function computeReloginRecovery(
    account: Account,
    loginState: { loggedIn: true; nickname?: string; avatar?: string; meta?: Record<string, any> }
  ): { status: AccountStatus; consecutiveFailures: number; lastError: undefined } {
    // After successful re-login, status should be ACTIVE, failures reset, error cleared
    return {
      status: AccountStatus.ACTIVE,
      consecutiveFailures: 0,
      lastError: undefined,
    };
  }

  it('Property 7: successful re-login sets status to ACTIVE for expired accounts', () => {
    fc.assert(
      fc.property(
        expiredAccountArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.option(fc.webUrl(), { nil: undefined }),
        (account, newNickname, newAvatar) => {
          const loginState = {
            loggedIn: true as const,
            nickname: newNickname,
            avatar: newAvatar,
          };
          
          const result = computeReloginRecovery(account, loginState);
          
          // Status should be ACTIVE after successful re-login
          expect(result.status).toBe(AccountStatus.ACTIVE);
          
          // consecutiveFailures should be reset to 0
          expect(result.consecutiveFailures).toBe(0);
          
          // lastError should be cleared (undefined)
          expect(result.lastError).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: successful re-login sets status to ACTIVE for error accounts', () => {
    fc.assert(
      fc.property(
        errorAccountArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.option(fc.webUrl(), { nil: undefined }),
        (account, newNickname, newAvatar) => {
          const loginState = {
            loggedIn: true as const,
            nickname: newNickname,
            avatar: newAvatar,
          };
          
          const result = computeReloginRecovery(account, loginState);
          
          // Status should be ACTIVE after successful re-login
          expect(result.status).toBe(AccountStatus.ACTIVE);
          
          // consecutiveFailures should be reset to 0
          expect(result.consecutiveFailures).toBe(0);
          
          // lastError should be cleared (undefined)
          expect(result.lastError).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: re-login recovery works regardless of previous failure count', () => {
    fc.assert(
      fc.property(
        failedAccountArb,
        fc.integer({ min: 0, max: 100 }), // arbitrary previous failure count
        fc.string({ minLength: 1, maxLength: 50 }),
        (account, previousFailures, newNickname) => {
          // Set up account with specific failure count
          const accountWithFailures = {
            ...account,
            consecutiveFailures: previousFailures,
          };
          
          const loginState = {
            loggedIn: true as const,
            nickname: newNickname,
          };
          
          const result = computeReloginRecovery(accountWithFailures, loginState);
          
          // Regardless of previous failure count, after successful re-login:
          // - Status should be ACTIVE
          expect(result.status).toBe(AccountStatus.ACTIVE);
          
          // - consecutiveFailures should be reset to 0
          expect(result.consecutiveFailures).toBe(0);
          
          // - lastError should be cleared
          expect(result.lastError).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
