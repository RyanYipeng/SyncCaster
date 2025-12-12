# Requirements Document

## Introduction

本功能将 doocs/md 项目（微信 Markdown 编辑器）完整集成到 SyncCaster 浏览器扩展中，作为一个独立的插件页面。用户在编辑文章时点击"公众号预览"按钮，将在新标签页中打开完整的 md 编辑器，享受主题切换、字体调整、代码块样式、数学公式渲染等全部功能。通过 Chrome Storage API 实现数据传递，用户可以在 md 编辑器中编辑和预览内容，然后将格式化后的 HTML 复制到微信公众号后台。

## Glossary

- **md 项目**: doocs/md 开源项目，一款高度简洁的微信 Markdown 编辑器
- **SyncCaster**: 本项目的浏览器扩展，多平台内容同步助手
- **Chrome Storage API**: Chrome 扩展的存储 API，用于在扩展的不同页面间传递数据
- **md-editor 页面**: 集成到扩展中的 md 编辑器独立页面
- **Editor.vue**: SyncCaster 的文章编辑页面组件
- **Markdown**: 轻量级标记语言
- **WeChat HTML**: 适配微信公众号的 HTML 格式，所有样式内联

## Requirements

### Requirement 1

**User Story:** As a content creator, I want to open a full-featured md editor when clicking "公众号预览", so that I can use all formatting features like theme switching, font adjustment, and code block styles.

#### Acceptance Criteria

1. WHEN a user clicks the "公众号预览" button in Editor.vue THEN the Extension SHALL open a new tab with the md-editor page
2. WHEN the md-editor page opens THEN the Extension SHALL automatically load the current article's Markdown content from Chrome Storage
3. WHEN the md-editor page loads content THEN the Extension SHALL display the content in the editor with default theme applied
4. WHEN the user modifies content in md-editor THEN the Extension SHALL provide real-time preview of the formatted output

### Requirement 2

**User Story:** As a content creator, I want to transfer my article content between Editor.vue and md-editor seamlessly, so that I can edit in either place without losing data.

#### Acceptance Criteria

1. WHEN Editor.vue saves content to Chrome Storage THEN the Extension SHALL store the article ID, title, and Markdown body
2. WHEN md-editor reads from Chrome Storage THEN the Extension SHALL retrieve and display the stored content correctly
3. WHEN the user closes md-editor THEN the Extension SHALL preserve any unsaved changes in Chrome Storage
4. WHEN Editor.vue reopens after md-editor use THEN the Extension SHALL reflect any content changes made in md-editor

### Requirement 3

**User Story:** As a content creator, I want to copy the formatted HTML from md-editor to paste into WeChat, so that the formatting is preserved correctly.

#### Acceptance Criteria

1. WHEN the user clicks the copy button in md-editor THEN the Extension SHALL copy the rendered HTML with inline styles to clipboard
2. WHEN the user pastes the copied content into WeChat editor THEN the WeChat editor SHALL display the content with correct formatting
3. WHEN copying is successful THEN the Extension SHALL display a "已复制渲染后的内容到剪贴板" confirmation message
4. IF the clipboard API fails THEN the Extension SHALL provide a fallback copy method using DOM selection

### Requirement 4

**User Story:** As a developer, I want to build and integrate the md project into the extension build process, so that the md-editor page is included in the extension package.

#### Acceptance Criteria

1. WHEN running the extension build command THEN the Build_System SHALL compile the md project and output to the extension's public folder
2. WHEN the extension is packaged THEN the Extension SHALL include md-editor.html and all required assets
3. WHEN the md-editor page loads THEN the Extension SHALL load all JavaScript and CSS assets from the extension's local files
4. WHEN the md project is updated THEN the Build_System SHALL support rebuilding the integrated md-editor

### Requirement 5

**User Story:** As a content creator, I want the md-editor to work offline within the extension, so that I can format content without internet connection.

#### Acceptance Criteria

1. WHEN the extension is installed THEN the Extension SHALL include all md-editor assets locally
2. WHEN the user opens md-editor without internet THEN the Extension SHALL load and function correctly
3. WHEN the user uses formatting features offline THEN the Extension SHALL apply all styles and transformations locally

### Requirement 6

**User Story:** As a content creator, I want to navigate back to the main editor from md-editor, so that I can continue with other editing tasks.

#### Acceptance Criteria

1. WHEN the user clicks a "返回编辑器" button in md-editor THEN the Extension SHALL navigate back to the Editor.vue page
2. WHEN navigating back THEN the Extension SHALL preserve the current article context
3. WHEN the user has unsaved changes THEN the Extension SHALL prompt the user before navigating away
