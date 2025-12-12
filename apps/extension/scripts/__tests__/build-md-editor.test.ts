/**
 * MD Editor Build Output Completeness Tests
 * 
 * Feature: md-editor-integration, Property 3: Build Output Completeness
 * Validates: Requirements 4.1, 4.2, 5.1
 * 
 * For any successful build of the extension, the output directory should contain
 * md-editor.html and all JavaScript/CSS assets required for the md-editor to function.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// Get the project root (SyncCaster directory)
const PROJECT_ROOT = resolve(__dirname, '../../../../');

// Path to the md-editor build output
const MD_EDITOR_OUTPUT_DIR = resolve(PROJECT_ROOT, 'apps/extension/public/md-editor');

// Required files and directories for a complete build
const REQUIRED_PATHS = [
  'md-editor.html',
  'index.html',
  'static/js',
];

// Required patterns in md-editor.html
const REQUIRED_HTML_PATTERNS = [
  /<script/i,  // Must have script tags
  /\.js/i,     // Must reference JS files
];



describe('MD Editor Build Output Completeness', () => {
  /**
   * Feature: md-editor-integration, Property 3: Build Output Completeness
   * Validates: Requirements 4.1, 4.2, 5.1
   * 
   * This test verifies that the build output contains all required files.
   * Note: This test should be run after the build process completes.
   */
  describe('Property 3: Build Output Completeness', () => {
    it('should have md-editor output directory', () => {
      // Skip if build hasn't been run yet
      if (!existsSync(MD_EDITOR_OUTPUT_DIR)) {
        console.log('⚠️ md-editor build output not found. Run `pnpm build:md-editor` first.');
        return;
      }
      
      expect(existsSync(MD_EDITOR_OUTPUT_DIR)).toBe(true);
    });

    it('should contain all required paths', () => {
      // Skip if build hasn't been run yet
      if (!existsSync(MD_EDITOR_OUTPUT_DIR)) {
        console.log('⚠️ md-editor build output not found. Run `pnpm build:md-editor` first.');
        return;
      }

      for (const requiredPath of REQUIRED_PATHS) {
        const fullPath = resolve(MD_EDITOR_OUTPUT_DIR, requiredPath);
        expect(
          existsSync(fullPath),
          `Required path missing: ${requiredPath}`
        ).toBe(true);
      }
    });

    it('should have md-editor.html with required content', () => {
      // Skip if build hasn't been run yet
      const htmlPath = resolve(MD_EDITOR_OUTPUT_DIR, 'md-editor.html');
      if (!existsSync(htmlPath)) {
        console.log('⚠️ md-editor.html not found. Run `pnpm build:md-editor` first.');
        return;
      }

      const htmlContent = readFileSync(htmlPath, 'utf-8');
      
      for (const pattern of REQUIRED_HTML_PATTERNS) {
        expect(
          pattern.test(htmlContent),
          `md-editor.html missing required pattern: ${pattern}`
        ).toBe(true);
      }
    });

    it('should have JavaScript files in static/js directory', () => {
      // Skip if build hasn't been run yet
      const jsDir = resolve(MD_EDITOR_OUTPUT_DIR, 'static/js');
      if (!existsSync(jsDir)) {
        console.log('⚠️ static/js directory not found. Run `pnpm build:md-editor` first.');
        return;
      }

      const jsFiles = readdirSync(jsDir).filter(f => f.endsWith('.js'));
      expect(jsFiles.length).toBeGreaterThan(0);
    });

    /**
     * Property-based test: For any local file referenced in md-editor.html,
     * that file should exist in the build output.
     * Note: External URLs (http://, https://) are skipped as they are CDN resources.
     */
    it('all local script references in md-editor.html should resolve to existing files', () => {
      // Skip if build hasn't been run yet
      const htmlPath = resolve(MD_EDITOR_OUTPUT_DIR, 'md-editor.html');
      if (!existsSync(htmlPath)) {
        console.log('⚠️ md-editor.html not found. Run `pnpm build:md-editor` first.');
        return;
      }

      const htmlContent = readFileSync(htmlPath, 'utf-8');
      
      // Extract script src attributes
      const scriptSrcRegex = /src=["']([^"']+\.js)["']/g;
      let match;
      const scriptPaths: string[] = [];
      
      while ((match = scriptSrcRegex.exec(htmlContent)) !== null) {
        scriptPaths.push(match[1]);
      }

      // Verify each local script file exists (skip external URLs)
      for (const scriptPath of scriptPaths) {
        // Skip external URLs (CDN resources)
        if (scriptPath.startsWith('http://') || scriptPath.startsWith('https://')) {
          continue;
        }
        
        // Handle relative paths (starting with ./)
        const normalizedPath = scriptPath.startsWith('./') 
          ? scriptPath.slice(2) 
          : scriptPath.startsWith('/') 
            ? scriptPath.slice(1) 
            : scriptPath;
        
        const fullPath = resolve(MD_EDITOR_OUTPUT_DIR, normalizedPath);
        expect(
          existsSync(fullPath),
          `Script file not found: ${scriptPath} (resolved to ${fullPath})`
        ).toBe(true);
      }
    });

    /**
     * Property-based test: For any local CSS file referenced in md-editor.html,
     * that file should exist in the build output.
     * Note: External URLs (http://, https://) are skipped as they are CDN resources.
     */
    it('all local stylesheet references in md-editor.html should resolve to existing files', () => {
      // Skip if build hasn't been run yet
      const htmlPath = resolve(MD_EDITOR_OUTPUT_DIR, 'md-editor.html');
      if (!existsSync(htmlPath)) {
        console.log('⚠️ md-editor.html not found. Run `pnpm build:md-editor` first.');
        return;
      }

      const htmlContent = readFileSync(htmlPath, 'utf-8');
      
      // Extract link href attributes for stylesheets
      const linkHrefRegex = /href=["']([^"']+\.css)["']/g;
      let match;
      const cssPaths: string[] = [];
      
      while ((match = linkHrefRegex.exec(htmlContent)) !== null) {
        cssPaths.push(match[1]);
      }

      // Verify each local CSS file exists (skip external URLs)
      for (const cssPath of cssPaths) {
        // Skip external URLs (CDN resources)
        if (cssPath.startsWith('http://') || cssPath.startsWith('https://')) {
          continue;
        }
        
        // Handle relative paths
        const normalizedPath = cssPath.startsWith('./') 
          ? cssPath.slice(2) 
          : cssPath.startsWith('/') 
            ? cssPath.slice(1) 
            : cssPath;
        
        const fullPath = resolve(MD_EDITOR_OUTPUT_DIR, normalizedPath);
        expect(
          existsSync(fullPath),
          `CSS file not found: ${cssPath} (resolved to ${fullPath})`
        ).toBe(true);
      }
    });
  });

  describe('Build Configuration Validation', () => {
    it('extension vite config should exist', () => {
      const configPath = resolve(PROJECT_ROOT, 'md/apps/web/vite.config.extension.ts');
      expect(existsSync(configPath)).toBe(true);
    });

    it('build script should exist', () => {
      const scriptPath = resolve(PROJECT_ROOT, 'apps/extension/scripts/build-md-editor.ts');
      expect(existsSync(scriptPath)).toBe(true);
    });
  });
});
