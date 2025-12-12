/**
 * SyncCaster Adapter Property Tests
 * 
 * Feature: md-editor-integration, Property 2: Content Preservation on Navigation
 * Validates: Requirements 2.4, 6.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock Chrome Storage API
const mockStorage: Record<string, any> = {};
const mockListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];

const STORAGE_KEY = 'synccaster_current_article';

interface SyncCasterArticle {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
  updatedAt: number;
}

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

// Simulate SyncCasterAdapter behavior for testing
// This mirrors the implementation in md/apps/web/src/utils/synccaster-adapter.ts
class TestSyncCasterAdapter {
  static async saveToExtension(title: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const existingArticle = result[STORAGE_KEY] as SyncCasterArticle | undefined;
        
        const article: SyncCasterArticle = {
          id: existingArticle?.id || 'md-editor-temp',
          title,
          content,
          sourceUrl: existingArticle?.sourceUrl,
          updatedAt: Date.now(),
        };

        chrome.storage.local.set({ [STORAGE_KEY]: article }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    });
  }

  static async loadFromExtension(): Promise<{ title: string; content: string } | null> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const article = result[STORAGE_KEY] as SyncCasterArticle | undefined;
        if (article) {
          resolve({
            title: article.title,
            content: article.content,
          });
        } else {
          resolve(null);
        }
      });
    });
  }
}

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
    runtime: { lastError: null, id: 'test-extension-id' },
    tabs: {
      getCurrent: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  vi.clearAllMocks();
});

// Arbitrary for article content
const articleContentArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 200 }),
  content: fc.string({ minLength: 0, maxLength: 50000 }),
});

describe('SyncCasterAdapter - Content Preservation', () => {
  /**
   * Feature: md-editor-integration, Property 2: Content Preservation on Navigation
   * Validates: Requirements 2.4, 6.2
   * 
   * For any article content modified in md-editor, when the user navigates back to Editor.vue,
   * the Editor.vue should display the same content that was last saved in md-editor.
   */
  it('Property 2: content modified in md-editor is preserved after navigation', async () => {
    await fc.assert(
      fc.asyncProperty(articleContentArb, async ({ title, content }) => {
        // Simulate: User modifies content in md-editor and it auto-saves
        await TestSyncCasterAdapter.saveToExtension(title, content);
        
        // Simulate: User navigates back to Editor.vue and loads content
        const loaded = await TestSyncCasterAdapter.loadFromExtension();
        
        // Verify content preservation
        expect(loaded).not.toBeNull();
        expect(loaded!.title).toBe(title);
        expect(loaded!.content).toBe(content);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2 extension: Multiple saves preserve only the latest content
   */
  it('Property 2 extension: multiple saves preserve only the latest content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(articleContentArb, { minLength: 2, maxLength: 10 }),
        async (articles) => {
          // Simulate multiple saves (user editing multiple times)
          for (const { title, content } of articles) {
            await TestSyncCasterAdapter.saveToExtension(title, content);
          }
          
          // Load should return the last saved content
          const loaded = await TestSyncCasterAdapter.loadFromExtension();
          const lastArticle = articles[articles.length - 1];
          
          expect(loaded).not.toBeNull();
          expect(loaded!.title).toBe(lastArticle.title);
          expect(loaded!.content).toBe(lastArticle.content);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2 extension: Existing article ID and sourceUrl are preserved on save
   */
  it('Property 2 extension: existing article metadata is preserved on content update', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          sourceUrl: fc.webUrl(),
        }),
        articleContentArb,
        async (metadata, { title, content }) => {
          // Setup: Pre-populate storage with existing article
          const existingArticle: SyncCasterArticle = {
            id: metadata.id,
            title: 'Original Title',
            content: 'Original Content',
            sourceUrl: metadata.sourceUrl,
            updatedAt: Date.now() - 1000,
          };
          mockStorage[STORAGE_KEY] = existingArticle;
          
          // Simulate: User modifies content in md-editor
          await TestSyncCasterAdapter.saveToExtension(title, content);
          
          // Verify: Content is updated but ID and sourceUrl are preserved
          const stored = mockStorage[STORAGE_KEY] as SyncCasterArticle;
          expect(stored.id).toBe(metadata.id);
          expect(stored.sourceUrl).toBe(metadata.sourceUrl);
          expect(stored.title).toBe(title);
          expect(stored.content).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });
});
