/**
 * Chrome Storage Bridge Property Tests
 * 
 * Feature: md-editor-integration, Property 1: Storage Round-Trip Consistency
 * Validates: Requirements 2.1, 2.2, 2.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { ChromeStorageBridge, type SyncCasterArticle } from '../chrome-storage-bridge';

// Mock Chrome Storage API
const mockStorage: Record<string, any> = {};
const mockListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];

const mockChromeStorage = {
  local: {
    get: vi.fn((keys: string[], callback: (result: Record<string, any>) => void) => {
      const result: Record<string, any> = {};
      for (const key of keys) {
        if (key in mockStorage) {
          result[key] = mockStorage[key];
        }
      }
      callback(result);
    }),
    set: vi.fn((items: Record<string, any>, callback: () => void) => {
      for (const [key, value] of Object.entries(items)) {
        const oldValue = mockStorage[key];
        mockStorage[key] = value;
        // Notify listeners
        mockListeners.forEach(listener => {
          listener({ [key]: { oldValue, newValue: value } }, 'local');
        });
      }
      callback();
    }),
    remove: vi.fn((keys: string[], callback: () => void) => {
      for (const key of keys) {
        const oldValue = mockStorage[key];
        delete mockStorage[key];
        // Notify listeners
        mockListeners.forEach(listener => {
          listener({ [key]: { oldValue, newValue: undefined } }, 'local');
        });
      }
      callback();
    }),
  },
  onChanged: {
    addListener: vi.fn((listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => {
      mockListeners.push(listener);
    }),
    removeListener: vi.fn((listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => {
      const index = mockListeners.indexOf(listener);
      if (index > -1) {
        mockListeners.splice(index, 1);
      }
    }),
  },
};

// Setup global chrome mock
beforeEach(() => {
  // Clear storage
  for (const key of Object.keys(mockStorage)) {
    delete mockStorage[key];
  }
  mockListeners.length = 0;
  
  // Setup chrome global
  (globalThis as any).chrome = {
    storage: mockChromeStorage,
    runtime: { lastError: null },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  vi.clearAllMocks();
});

// Arbitrary for SyncCasterArticle
const syncCasterArticleArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 200 }),
  content: fc.string({ minLength: 0, maxLength: 50000 }),
  sourceUrl: fc.option(fc.webUrl(), { nil: undefined }),
  updatedAt: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
});

describe('ChromeStorageBridge', () => {
  /**
   * Feature: md-editor-integration, Property 1: Storage Round-Trip Consistency
   * Validates: Requirements 2.1, 2.2, 2.4
   * 
   * For any valid article with non-empty ID, title, and content, saving to Chrome Storage
   * and then reading back should return an article with equivalent ID, title, and content values.
   */
  it('Property 1: storage round-trip preserves article data', async () => {
    await fc.assert(
      fc.asyncProperty(syncCasterArticleArb, async (article) => {
        // Save article
        await ChromeStorageBridge.saveArticle(article);
        
        // Load article
        const loaded = await ChromeStorageBridge.loadArticle();
        
        // Verify round-trip consistency
        expect(loaded).not.toBeNull();
        expect(loaded!.id).toBe(article.id);
        expect(loaded!.title).toBe(article.title);
        expect(loaded!.content).toBe(article.content);
        expect(loaded!.updatedAt).toBe(article.updatedAt);
        
        if (article.sourceUrl !== undefined) {
          expect(loaded!.sourceUrl).toBe(article.sourceUrl);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should return null when no article is stored', async () => {
    const loaded = await ChromeStorageBridge.loadArticle();
    expect(loaded).toBeNull();
  });

  it('should clear article correctly', async () => {
    const article: SyncCasterArticle = {
      id: 'test-id',
      title: 'Test Title',
      content: 'Test Content',
      updatedAt: Date.now(),
    };

    await ChromeStorageBridge.saveArticle(article);
    let loaded = await ChromeStorageBridge.loadArticle();
    expect(loaded).not.toBeNull();

    await ChromeStorageBridge.clearArticle();
    loaded = await ChromeStorageBridge.loadArticle();
    expect(loaded).toBeNull();
  });

  it('should notify listeners on article change', async () => {
    const receivedArticles: (SyncCasterArticle | null)[] = [];
    
    const unsubscribe = ChromeStorageBridge.onArticleChange((article) => {
      receivedArticles.push(article);
    });

    const article: SyncCasterArticle = {
      id: 'test-id',
      title: 'Test Title',
      content: 'Test Content',
      updatedAt: Date.now(),
    };

    await ChromeStorageBridge.saveArticle(article);
    
    expect(receivedArticles.length).toBe(1);
    expect(receivedArticles[0]?.id).toBe(article.id);

    unsubscribe();
  });

  it('should return correct storage key', () => {
    expect(ChromeStorageBridge.getStorageKey()).toBe('synccaster_current_article');
  });
});
