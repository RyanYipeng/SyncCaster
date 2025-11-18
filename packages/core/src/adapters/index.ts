/**
 * 平台适配器工厂
 */
import { PlatformAdapter, type AdapterOptions } from './base';
import { MarkdownAdapter } from './markdown';
import { HtmlAdapter } from './html';
import { getPlatformConfig } from '../platforms/configs';
import type { PlatformCapability } from '../types/ast';

export { PlatformAdapter, MarkdownAdapter, HtmlAdapter };
export type { AdapterOptions };

/**
 * 创建适配器
 */
export function createAdapter(
  platformId: string,
  options: AdapterOptions = {}
): PlatformAdapter {
  const config = getPlatformConfig(platformId);
  
  if (!config) {
    throw new Error(`Unknown platform: ${platformId}`);
  }

  return createAdapterFromConfig(config, options);
}

/**
 * 从配置创建适配器
 */
export function createAdapterFromConfig(
  config: PlatformCapability,
  options: AdapterOptions = {}
): PlatformAdapter {
  const outputFormat = config.strategy.outputFormat;

  switch (outputFormat) {
    case 'markdown':
      return new MarkdownAdapter(config, options);
    case 'html':
      return new HtmlAdapter(config, options);
    case 'custom':
      // 预留给特殊平台
      throw new Error(`Custom adapter not implemented for ${config.id}`);
    default:
      throw new Error(`Unknown output format: ${outputFormat}`);
  }
}

/**
 * 批量创建适配器
 */
export function createAdapters(
  platformIds: string[],
  options: AdapterOptions = {}
): Map<string, PlatformAdapter> {
  const adapters = new Map<string, PlatformAdapter>();

  for (const platformId of platformIds) {
    try {
      const adapter = createAdapter(platformId, options);
      adapters.set(platformId, adapter);
    } catch (error) {
      console.warn(`Failed to create adapter for ${platformId}:`, error);
    }
  }

  return adapters;
}
