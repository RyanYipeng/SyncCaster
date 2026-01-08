# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SyncCaster is a Chrome Extension (Manifest V3) that helps content creators publish articles to multiple blog platforms with one click. It runs entirely locally and uses DOM automation to simulate human publishing actions.

## Common Commands

```bash
# Install dependencies
pnpm install

# Development mode (watch mode)
pnpm dev

# Build extension
pnpm build

# Build all packages
pnpm build:all

# Run tests
pnpm test

# Run single test file
pnpm test <path-to-test-file>

# Lint
pnpm lint

# Format code
pnpm format
```

## Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select `apps/extension/dist`

## Architecture

### Monorepo Structure (pnpm workspaces)

- **apps/extension/** - Chrome extension application
- **packages/core/** - Core types, database (Dexie/IndexedDB), AST processing, Markdown/HTML conversion
- **packages/adapters/** - Platform adapters for each blog platform
- **packages/utils/** - Shared utility functions (DOM helpers, logger)

### Extension Architecture

```
apps/extension/src/
├── background/           # Service Worker
│   ├── index.ts         # Message handling, task scheduling
│   ├── publish-engine.ts # Core publishing engine
│   ├── platform-api.ts  # Platform API implementations
│   ├── account-service.ts # Account management
│   └── inpage-runner.ts # In-page script executor
├── content-scripts/     # Page injection scripts
├── ui/                  # Vue 3 UI components
│   ├── popup/          # Extension popup
│   ├── sidepanel/      # Side panel
│   └── options/        # Settings page
└── manifest.ts         # Extension manifest configuration
```

### Adapter Pattern

Each platform has an adapter in `packages/adapters/src/` implementing the `PlatformAdapter` interface:

```typescript
interface PlatformAdapter {
  id: PlatformId;
  name: string;
  kind: 'dom' | 'metaweblog' | 'restApi';
  capabilities: PlatformCapabilities;

  ensureAuth(ctx): Promise<AuthSession>;
  transform(post, ctx): Promise<PlatformPayload>;
  publish(payload, ctx): Promise<PublishResult>;

  dom?: {
    matchers: string[];
    fillAndPublish(payload): Promise<PublishResult>;
  };
}
```

To add a new platform:
1. Create adapter file in `packages/adapters/src/<platform>.ts`
2. Implement `PlatformAdapter` interface
3. Export and register in `packages/adapters/src/index.ts`
4. Add platform ID to `packages/core/src/types/index.ts`

### Data Models

- **CanonicalPost** - Unified content model (Markdown body, AST, assets, formulas)
- **Job** - Publishing task with targets, state, progress, and logs
- **Account** - Platform account with status and authentication info

### DOM Automation Flow

1. Create background tab with target platform URL
2. Wait for page load
3. Execute `fillAndPublish` in page's MAIN world via `chrome.scripting.executeScript`
4. Return result and close tab

## Supported Platforms

wechat, zhihu, juejin, csdn, jianshu, cnblogs, oschina, 51cto, tencent-cloud, aliyun, segmentfault, bilibili

## Tech Stack

- Vue 3 + TypeScript
- Vite + pnpm monorepo
- UnoCSS
- IndexedDB (Dexie.js)
- Chrome Extension Manifest V3

## Debugging

1. **Service Worker logs**: Right-click extension icon → Inspect Service Worker
2. **Page logs**: Open DevTools on target platform page
3. **Keep tabs open**: Set `closeTab: false` in `publish-engine.ts` for debugging
