/**
 * Platform API Cookie Detection Property Tests
 * 
 * Feature: account-status-enhancement
 * Tests Cookie detection correctness and fallback behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { 
  COOKIE_CONFIGS, 
  detectViaCookies, 
  shouldFallbackToCookie,
  fetchUserInfoWithFallback,
  AuthErrorType,
  type UserInfo
} from '../platform-api';

// Platform IDs that have Cookie detection configured
const platformsWithCookieConfig = Object.keys(COOKIE_CONFIGS);

// Arbitrary for platform IDs with Cookie config
const platformIdArb = fc.constantFrom(...platformsWithCookieConfig);

// Mock chrome.cookies API
const mockCookiesGetAll = vi.fn();

// Setup chrome mock
beforeEach(() => {
  vi.stubGlobal('chrome', {
    cookies: {
      getAll: mockCookiesGetAll,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Cookie Detection Configuration', () => {
  /**
   * Verify all 12 platforms have Cookie detection configured
   */
  it('should have Cookie detection configured for all 12 platforms', () => {
    const expectedPlatforms = [
      'juejin', 'csdn', 'zhihu', 'bilibili', 'jianshu', 'cnblogs',
      '51cto', 'tencent-cloud', 'aliyun', 'segmentfault', 'oschina', 'wechat'
    ];
    
    for (const platform of expectedPlatforms) {
      expect(COOKIE_CONFIGS[platform]).toBeDefined();
      expect(COOKIE_CONFIGS[platform].url).toBeTruthy();
      expect(COOKIE_CONFIGS[platform].sessionCookies.length).toBeGreaterThan(0);
    }
  });

  /**
   * Verify each platform config has valid structure
   */
  it('each platform config should have valid url and sessionCookies', () => {
    fc.assert(
      fc.property(platformIdArb, (platform) => {
        const config = COOKIE_CONFIGS[platform];
        
        // URL should be a non-empty string starting with https://
        expect(typeof config.url).toBe('string');
        expect(config.url.length).toBeGreaterThan(0);
        expect(config.url.startsWith('https://')).toBe(true);
        
        // sessionCookies should be a non-empty array of strings
        expect(Array.isArray(config.sessionCookies)).toBe(true);
        expect(config.sessionCookies.length).toBeGreaterThan(0);
        config.sessionCookies.forEach(cookie => {
          expect(typeof cookie).toBe('string');
          expect(cookie.length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 100 }
    );
  });
});

describe('Cookie Detection Correctness', () => {
  /**
   * Feature: account-status-enhancement, Property 2: Cookie Detection Correctness
   * Validates: Requirements 1.2
   * 
   * For any set of cookies for a platform, the Cookie detection should return 
   * loggedIn=true if and only if at least one of the configured session cookies 
   * exists with a non-empty value.
   */
  it('Property 2: Cookie detection returns loggedIn=true iff session cookie exists with non-empty value', async () => {
    await fc.assert(
      fc.asyncProperty(
        platformIdArb,
        fc.boolean(), // whether to include a valid session cookie
        fc.array(fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          value: fc.string({ maxLength: 100 }),
        }), { minLength: 0, maxLength: 10 }),
        async (platform, includeValidCookie, randomCookies) => {
          const config = COOKIE_CONFIGS[platform];
          
          // Build mock cookies array
          const mockCookies: Array<{ name: string; value: string }> = [...randomCookies];
          
          if (includeValidCookie) {
            // Add a valid session cookie with non-empty value
            const sessionCookieName = config.sessionCookies[0];
            mockCookies.push({ name: sessionCookieName, value: 'valid_session_value' });
          }
          
          // Filter out any random cookies that accidentally match session cookies with non-empty values
          const hasValidSessionCookie = mockCookies.some(
            c => config.sessionCookies.includes(c.name) && c.value !== '' && c.value !== undefined
          );
          
          mockCookiesGetAll.mockResolvedValue(mockCookies);
          
          const result = await detectViaCookies(platform);
          
          // Property: loggedIn should be true iff there's a valid session cookie
          expect(result.loggedIn).toBe(hasValidSessionCookie);
          expect(result.detectionMethod).toBe('cookie');
          expect(result.platform).toBe(platform);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that empty cookie values are not considered valid
   */
  it('empty cookie values should not be considered valid sessions', async () => {
    await fc.assert(
      fc.asyncProperty(platformIdArb, async (platform) => {
        const config = COOKIE_CONFIGS[platform];
        
        // Create cookies with session cookie names but empty values
        const mockCookies = config.sessionCookies.map(name => ({
          name,
          value: '',
        }));
        
        mockCookiesGetAll.mockResolvedValue(mockCookies);
        
        const result = await detectViaCookies(platform);
        
        expect(result.loggedIn).toBe(false);
        expect(result.errorType).toBe(AuthErrorType.LOGGED_OUT);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Test that unconfigured platforms return appropriate error
   */
  it('unconfigured platforms should return error', async () => {
    const result = await detectViaCookies('unknown-platform');
    
    expect(result.loggedIn).toBe(false);
    expect(result.error).toContain('不支持 Cookie 检测');
    expect(result.errorType).toBe(AuthErrorType.UNKNOWN);
  });
});

describe('Fallback Decision Logic', () => {
  /**
   * Feature: account-status-enhancement, Property 1: Detection Fallback Behavior
   * Validates: Requirements 1.1, 1.3, 1.4
   * 
   * For any platform with Cookie detection configured, when the primary API returns 
   * a 404 or 500+ error, the system should attempt Cookie detection before determining 
   * the final status. When API returns 401/403, no fallback should be attempted.
   */
  it('Property 1: shouldFallbackToCookie returns false for LOGGED_OUT errors', () => {
    fc.assert(
      fc.property(platformIdArb, (platform) => {
        const userInfo: UserInfo = {
          loggedIn: false,
          platform,
          errorType: AuthErrorType.LOGGED_OUT,
          error: '需要登录',
          retryable: false,
        };
        
        expect(shouldFallbackToCookie(userInfo)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('shouldFallbackToCookie returns true for retryable errors', () => {
    const retryableErrorTypes = [
      AuthErrorType.API_ERROR,
      AuthErrorType.NETWORK_ERROR,
      AuthErrorType.RATE_LIMITED,
    ];
    
    fc.assert(
      fc.property(
        platformIdArb,
        fc.constantFrom(...retryableErrorTypes),
        (platform, errorType) => {
          const userInfo: UserInfo = {
            loggedIn: false,
            platform,
            errorType,
            error: '临时错误',
            retryable: true,
          };
          
          expect(shouldFallbackToCookie(userInfo)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('shouldFallbackToCookie returns false for successful login', () => {
    fc.assert(
      fc.property(platformIdArb, (platform) => {
        const userInfo: UserInfo = {
          loggedIn: true,
          platform,
          nickname: 'TestUser',
        };
        
        expect(shouldFallbackToCookie(userInfo)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('shouldFallbackToCookie returns false when primary already uses cookie/html detection', () => {
    fc.assert(
      fc.property(platformIdArb, fc.constantFrom<'cookie' | 'html'>('cookie', 'html'), (platform, method) => {
        const userInfo: UserInfo = {
          loggedIn: false,
          platform,
          errorType: AuthErrorType.API_ERROR,
          error: '临时错误',
          retryable: true,
          detectionMethod: method,
        };

        expect(shouldFallbackToCookie(userInfo)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Fallback Execution', () => {
  /**
   * Feature: account-status-enhancement, Property 6: Fallback Execution Order
   * Validates: Requirements 6.3, 6.4
   * 
   * For any platform with multiple detection methods configured, when the primary 
   * method fails with a retryable error, fallback methods should be executed in 
   * the configured order until one succeeds or all fail.
   */
  it('Property 6: fetchUserInfoWithFallback tries Cookie detection on retryable API failure', async () => {
    await fc.assert(
      fc.asyncProperty(platformIdArb, async (platform) => {
        // Clear mocks before each property test iteration
        mockCookiesGetAll.mockClear();
        
        // Mock primary API to fail with retryable error
        const primaryFetch = vi.fn().mockResolvedValue({
          loggedIn: false,
          platform,
          errorType: AuthErrorType.API_ERROR,
          error: 'API 接口不可用',
          retryable: true,
        });
        
        // Mock Cookie detection to succeed
        const config = COOKIE_CONFIGS[platform];
        mockCookiesGetAll.mockResolvedValue([
          { name: config.sessionCookies[0], value: 'valid_session' }
        ]);
        
        const result = await fetchUserInfoWithFallback(platform, primaryFetch);
        
        // Primary should be called
        expect(primaryFetch).toHaveBeenCalled();
        
        // Cookie detection should be attempted (via chrome.cookies.getAll)
        expect(mockCookiesGetAll).toHaveBeenCalled();
        
        // Result should be from Cookie detection (success)
        expect(result.loggedIn).toBe(true);
        expect(result.detectionMethod).toBe('cookie');
      }),
      { numRuns: 50 }
    );
  });

  it('fetchUserInfoWithFallback skips Cookie detection on LOGGED_OUT error', async () => {
    await fc.assert(
      fc.asyncProperty(platformIdArb, async (platform) => {
        // Clear mocks before each property test iteration
        mockCookiesGetAll.mockClear();
        
        // Mock primary API to fail with LOGGED_OUT (non-retryable)
        const primaryFetch = vi.fn().mockResolvedValue({
          loggedIn: false,
          platform,
          errorType: AuthErrorType.LOGGED_OUT,
          error: '登录已失效',
          retryable: false,
        });
        
        const result = await fetchUserInfoWithFallback(platform, primaryFetch);
        
        // Primary should be called
        expect(primaryFetch).toHaveBeenCalled();
        
        // Cookie detection should NOT be attempted
        expect(mockCookiesGetAll).not.toHaveBeenCalled();
        
        // Result should be from primary (LOGGED_OUT)
        expect(result.loggedIn).toBe(false);
        expect(result.errorType).toBe(AuthErrorType.LOGGED_OUT);
      }),
      { numRuns: 50 }
    );
  });

  it('fetchUserInfoWithFallback returns primary result on success', async () => {
    await fc.assert(
      fc.asyncProperty(
        platformIdArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        async (platform, nickname) => {
          // Clear mocks before each property test iteration
          mockCookiesGetAll.mockClear();
          
          // Mock primary API to succeed
          const primaryFetch = vi.fn().mockResolvedValue({
            loggedIn: true,
            platform,
            nickname,
          });
          
          const result = await fetchUserInfoWithFallback(platform, primaryFetch);
          
          // Primary should be called
          expect(primaryFetch).toHaveBeenCalled();
          
          // Cookie detection should NOT be attempted
          expect(mockCookiesGetAll).not.toHaveBeenCalled();
          
          // Result should be from primary (success)
          expect(result.loggedIn).toBe(true);
          expect(result.nickname).toBe(nickname);
          expect(result.detectionMethod).toBe('api');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('fetchUserInfoWithFallback returns primary error when both methods fail', async () => {
    await fc.assert(
      fc.asyncProperty(platformIdArb, async (platform) => {
        // Clear mocks before each property test iteration
        mockCookiesGetAll.mockClear();
        
        const primaryError = 'API 接口不可用';
        
        // Mock primary API to fail with retryable error
        const primaryFetch = vi.fn().mockResolvedValue({
          loggedIn: false,
          platform,
          errorType: AuthErrorType.API_ERROR,
          error: primaryError,
          retryable: true,
        });
        
        // Mock Cookie detection to also fail (no valid cookies)
        mockCookiesGetAll.mockResolvedValue([]);
        
        const result = await fetchUserInfoWithFallback(platform, primaryFetch);
        
        // Both methods should be attempted
        expect(primaryFetch).toHaveBeenCalled();
        expect(mockCookiesGetAll).toHaveBeenCalled();
        
        // Result should be from primary (preserves original error info)
        expect(result.loggedIn).toBe(false);
        expect(result.error).toBe(primaryError);
      }),
      { numRuns: 50 }
    );
  });
});
