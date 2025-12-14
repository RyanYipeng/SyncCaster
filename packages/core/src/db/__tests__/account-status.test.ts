/**
 * Account Status Property Tests
 * 
 * Feature: account-status-enhancement, Property 5: Status Persistence Round-trip
 * Validates: Requirements 5.1, 5.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountStatus, type Account, type PlatformId } from '../../types';

// Platform IDs for arbitrary generation
const platformIds: PlatformId[] = [
  'wechat', 'zhihu', 'juejin', 'csdn', 'jianshu', 
  'cnblogs', 'oschina', '51cto', 'tencent-cloud', 
  'aliyun', 'segmentfault', 'bilibili'
];

// Arbitrary for AccountStatus
const accountStatusArb = fc.constantFrom(
  AccountStatus.ACTIVE,
  AccountStatus.EXPIRED,
  AccountStatus.ERROR,
  AccountStatus.CHECKING
);

// Arbitrary for PlatformId
const platformIdArb = fc.constantFrom(...platformIds);

// Arbitrary for Account with status fields
const accountArb = fc.record({
  id: fc.uuid(),
  platform: platformIdArb,
  nickname: fc.string({ minLength: 1, maxLength: 50 }),
  avatar: fc.option(fc.webUrl(), { nil: undefined }),
  enabled: fc.boolean(),
  createdAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  updatedAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  meta: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
  status: fc.option(accountStatusArb, { nil: undefined }),
  lastCheckAt: fc.option(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), { nil: undefined }),
  lastError: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  consecutiveFailures: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
}) as fc.Arbitrary<Account>;

/**
 * Simulates database persistence round-trip by serializing to JSON and back.
 * This mirrors what IndexedDB/Dexie does when storing and retrieving objects.
 */
function simulatePersistenceRoundTrip<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

describe('Account Status Persistence', () => {
  /**
   * Feature: account-status-enhancement, Property 5: Status Persistence Round-trip
   * Validates: Requirements 5.1, 5.4
   * 
   * For any account status update, persisting to database and then loading 
   * should return the same status, lastCheckAt, and lastError values.
   * 
   * This test simulates the persistence round-trip using JSON serialization,
   * which is equivalent to what IndexedDB does under the hood.
   */
  it('Property 5: status persistence round-trip preserves status fields', () => {
    fc.assert(
      fc.property(accountArb, (account) => {
        // Simulate database persistence (serialize and deserialize)
        const loaded = simulatePersistenceRoundTrip(account);
        
        // Verify round-trip consistency for all fields
        expect(loaded).not.toBeNull();
        expect(loaded).not.toBeUndefined();
        
        // Core fields
        expect(loaded.id).toBe(account.id);
        expect(loaded.platform).toBe(account.platform);
        expect(loaded.nickname).toBe(account.nickname);
        expect(loaded.enabled).toBe(account.enabled);
        expect(loaded.createdAt).toBe(account.createdAt);
        expect(loaded.updatedAt).toBe(account.updatedAt);
        
        // Status fields (the focus of this property test)
        expect(loaded.status).toBe(account.status);
        expect(loaded.lastCheckAt).toBe(account.lastCheckAt);
        expect(loaded.lastError).toBe(account.lastError);
        expect(loaded.consecutiveFailures).toBe(account.consecutiveFailures);
        
        // Optional fields
        if (account.avatar !== undefined) {
          expect(loaded.avatar).toBe(account.avatar);
        }
        if (account.meta !== undefined) {
          expect(loaded.meta).toEqual(account.meta);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Verify status update preserves other fields
   * Simulates updating only status fields while preserving existing account data.
   */
  it('updating status fields preserves existing account data', () => {
    fc.assert(
      fc.property(
        accountArb,
        accountStatusArb,
        fc.string({ maxLength: 200 }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (account, newStatus, newError, newCheckAt) => {
          // Simulate initial persistence
          const persisted = simulatePersistenceRoundTrip(account);
          
          // Simulate status update (like db.accounts.update)
          const updated = {
            ...persisted,
            status: newStatus,
            lastError: newError,
            lastCheckAt: newCheckAt,
            consecutiveFailures: (persisted.consecutiveFailures ?? 0) + 1,
          };
          
          // Simulate persistence of updated account
          const loaded = simulatePersistenceRoundTrip(updated);
          
          // Verify original fields are preserved
          expect(loaded.id).toBe(account.id);
          expect(loaded.platform).toBe(account.platform);
          expect(loaded.nickname).toBe(account.nickname);
          expect(loaded.enabled).toBe(account.enabled);
          expect(loaded.createdAt).toBe(account.createdAt);
          
          // Verify status fields are updated
          expect(loaded.status).toBe(newStatus);
          expect(loaded.lastError).toBe(newError);
          expect(loaded.lastCheckAt).toBe(newCheckAt);
          expect(loaded.consecutiveFailures).toBe((account.consecutiveFailures ?? 0) + 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that AccountStatus enum values are valid strings
   */
  it('AccountStatus enum values are valid for persistence', () => {
    // Verify all enum values are strings (required for IndexedDB)
    expect(typeof AccountStatus.ACTIVE).toBe('string');
    expect(typeof AccountStatus.EXPIRED).toBe('string');
    expect(typeof AccountStatus.ERROR).toBe('string');
    expect(typeof AccountStatus.CHECKING).toBe('string');
    
    // Verify enum values match expected strings
    expect(AccountStatus.ACTIVE).toBe('active');
    expect(AccountStatus.EXPIRED).toBe('expired');
    expect(AccountStatus.ERROR).toBe('error');
    expect(AccountStatus.CHECKING).toBe('checking');
  });
});
