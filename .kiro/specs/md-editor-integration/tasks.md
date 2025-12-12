# Implementation Plan

- [x] 1. Create Chrome Storage Bridge Module





  - [x] 1.1 Create ChromeStorageBridge class in packages/core


    - Create `packages/core/src/storage/chrome-storage-bridge.ts`
    - Implement `saveArticle()`, `loadArticle()`, `clearArticle()` methods
    - Implement `onArticleChange()` listener for storage changes
    - Define `SyncCasterArticle` interface
    - _Requirements: 2.1, 2.2_
  - [x] 1.2 Write property test for storage round-trip


    - **Property 1: Storage Round-Trip Consistency**
    - **Validates: Requirements 2.1, 2.2, 2.4**
  - [x] 1.3 Export ChromeStorageBridge from packages/core index


    - Update `packages/core/src/index.ts` to export the new module
    - _Requirements: 2.1_

- [x] 2. Modify MD Project for Extension Integration





  - [x] 2.1 Create SyncCaster adapter in md project


    - Create `md/apps/web/src/utils/synccaster-adapter.ts`
    - Implement `isInExtension()` to detect extension environment
    - Implement `loadFromExtension()` to read from Chrome Storage
    - Implement `saveToExtension()` to write to Chrome Storage
    - Implement `navigateBack()` for returning to Editor.vue
    - _Requirements: 1.2, 2.2, 6.1_
  - [x] 2.2 Modify md project's main.ts for extension mode


    - Add extension detection logic
    - Auto-load content from Chrome Storage when in extension mode
    - _Requirements: 1.2, 1.3_
  - [x] 2.3 Add "返回编辑器" button to md editor header


    - Modify `md/apps/web/src/components/editor/editor-header/index.vue`
    - Show button only when in extension mode
    - Implement navigation back to Editor.vue
    - _Requirements: 6.1, 6.2_
  - [x] 2.4 Add auto-save on content change


    - Modify md project's post store to auto-save to Chrome Storage
    - Implement debounced save to avoid excessive writes
    - _Requirements: 2.3, 2.4_
  - [x] 2.5 Write property test for content preservation


    - **Property 2: Content Preservation on Navigation**
    - **Validates: Requirements 2.4, 6.2**

- [x] 3. Configure MD Project Build for Extension






  - [x] 3.1 Create extension-specific vite config for md project

    - Create `md/apps/web/vite.config.extension.ts`
    - Configure output to `apps/extension/public/md-editor/`
    - Set base path to relative (`./`)
    - Disable analytics and external dependencies
    - _Requirements: 4.1, 4.3, 5.1_
  - [x] 3.2 Add build script for md-editor


    - Create `apps/extension/scripts/build-md-editor.ts`
    - Build md project with extension config
    - Rename output index.html to md-editor.html
    - _Requirements: 4.1, 4.2_
  - [x] 3.3 Update extension package.json with build commands


    - Add `build:md-editor` script
    - Update main build script to include md-editor build
    - _Requirements: 4.1, 4.4_
  - [x] 3.4 Write test for build output completeness


    - **Property 3: Build Output Completeness**
    - **Validates: Requirements 4.1, 4.2, 5.1**

- [x] 4. Integrate MD Editor into Extension





  - [x] 4.1 Update extension manifest for md-editor page


    - Add md-editor.html to web_accessible_resources
    - Update `apps/extension/src/manifest.ts`
    - _Requirements: 4.2, 5.2_
  - [x] 4.2 Modify Editor.vue to open md-editor


    - Replace inline preview with "打开公众号编辑器" button
    - Implement `openMdEditor()` function
    - Save article to Chrome Storage before opening
    - Open md-editor.html in new tab
    - _Requirements: 1.1, 2.1_
  - [x] 4.3 Add content sync on Editor.vue focus


    - Listen for tab focus events
    - Reload content from Chrome Storage when Editor.vue regains focus
    - _Requirements: 2.4_

- [x] 5. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build and Test Integration





  - [x] 6.1 Run md-editor build


    - Execute build script
    - Verify output files in `apps/extension/public/md-editor/`
    - _Requirements: 4.1, 4.2_
  - [x] 6.2 Build complete extension


    - Run `pnpm build` in apps/extension
    - Verify md-editor.html is included in dist
    - _Requirements: 4.2, 5.1_

  - [x] 6.3 Manual integration test

    - Load extension in Chrome
    - Test complete flow: Editor.vue → md-editor → copy → return
    - Verify content sync works correctly
    - _Requirements: 1.1, 1.2, 2.4, 3.1, 6.1_

- [x] 7. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
