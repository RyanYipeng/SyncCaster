/**
 * MD Editor Build Script
 * 
 * Builds the md project with extension-specific configuration and integrates
 * it into the SyncCaster extension.
 * 
 * Requirements: 4.1, 4.2
 */

import { execSync } from 'node:child_process'
import { existsSync, renameSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MD_PROJECT_DIR = resolve(__dirname, '../../../md/apps/web')
const OUTPUT_DIR = resolve(__dirname, '../public/md-editor')

async function buildMdEditor(): Promise<void> {
  console.log('🚀 Building md-editor for extension...')
  console.log(`   MD Project: ${MD_PROJECT_DIR}`)
  console.log(`   Output: ${OUTPUT_DIR}`)

  // Step 1: Build md project with extension config
  console.log('\n📦 Step 1: Building md project...')
  try {
    execSync('pnpm vite build --config vite.config.extension.ts', {
      cwd: MD_PROJECT_DIR,
      stdio: 'inherit',
    })
  } catch (error) {
    console.error('❌ Failed to build md project')
    throw error
  }

  // Step 2: Verify output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    console.error(`❌ Output directory not found: ${OUTPUT_DIR}`)
    throw new Error('Build output directory not found')
  }

  // Step 3: Rename index.html to md-editor.html and make CSP-compliant
  console.log('\n📝 Step 2: Renaming index.html to md-editor.html...')
  const indexPath = resolve(OUTPUT_DIR, 'index.html')
  const mdEditorPath = resolve(OUTPUT_DIR, 'md-editor.html')

  if (existsSync(indexPath)) {
    // Read the HTML content
    let htmlContent = readFileSync(indexPath, 'utf-8')
    
    // Remove inline scripts (CSP violation in Chrome extensions)
    // Remove the theme detection inline script
    htmlContent = htmlContent.replace(
      /<script>\s*const theme = localStorage\.getItem[\s\S]*?<\/script>/g,
      '<!-- Theme detection moved to main bundle -->'
    )
    
    // Remove the MathJax config inline script
    htmlContent = htmlContent.replace(
      /<script>\s*window\.MathJax[\s\S]*?<\/script>/g,
      '<!-- MathJax config moved to main bundle -->'
    )
    
    // Remove the timeout tip inline script
    htmlContent = htmlContent.replace(
      /<script>\s*setTimeout\(\(\) => \{[\s\S]*?<\/script>/g,
      '<!-- Timeout tip script removed -->'
    )
    
    // Remove external CDN scripts (CSP violation - these are loaded from external domains)
    // MathJax CDN
    htmlContent = htmlContent.replace(
      /<script[^>]*id="MathJax-script"[^>]*src="https:\/\/cdn-doocs[^"]*"[^>]*><\/script>/g,
      '<!-- MathJax loaded from local bundle -->'
    )
    
    // Mermaid CDN
    htmlContent = htmlContent.replace(
      /<script[^>]*src="https:\/\/cdn-doocs[^"]*mermaid[^"]*"[^>]*><\/script>/g,
      '<!-- Mermaid loaded from local bundle -->'
    )
    
    // Article-sync CDN
    htmlContent = htmlContent.replace(
      /<script[^>]*src="https:\/\/cdn-doocs[^"]*article-sync[^"]*"[^>]*><\/script>/g,
      '<!-- Article-sync not needed in extension -->'
    )
    
    // Write to md-editor.html
    writeFileSync(mdEditorPath, htmlContent)
    
    // Keep index.html as well for compatibility
    console.log(`   ✓ Created ${mdEditorPath}`)
    console.log(`   ✓ Removed inline scripts for CSP compliance`)
    console.log(`   ✓ Removed external CDN scripts for CSP compliance`)
  } else {
    console.error(`❌ index.html not found at ${indexPath}`)
    throw new Error('index.html not found in build output')
  }

  // Step 4: Verify required assets exist
  console.log('\n🔍 Step 3: Verifying build output...')
  const requiredPaths = [
    'md-editor.html',
    'static/js',
  ]

  for (const reqPath of requiredPaths) {
    const fullPath = resolve(OUTPUT_DIR, reqPath)
    if (!existsSync(fullPath)) {
      console.error(`❌ Required path not found: ${reqPath}`)
      throw new Error(`Missing required build output: ${reqPath}`)
    }
    console.log(`   ✓ ${reqPath}`)
  }

  console.log('\n✅ md-editor build complete!')
  console.log(`   Output: ${OUTPUT_DIR}`)
}

// Run if executed directly
buildMdEditor().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})

export { buildMdEditor }
