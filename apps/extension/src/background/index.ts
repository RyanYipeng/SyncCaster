/**
 * Background Service Worker
 * 负责任务编排、队列管理、跨平台发布等
 */

import { db, type Job } from '@synccaster/core';
import { getAdapter } from '@synccaster/adapters';
import { Logger } from '@synccaster/utils';

const logger = new Logger('background');

// 动态导入 v2.0 处理器，避免阻塞启动
let processCollectedHTML: any = null;
try {
  import('./content-processor-v2').then((module) => {
    processCollectedHTML = module.processCollectedHTML;
    logger.info('v2', 'v2.0 processor loaded successfully');
  }).catch((error) => {
    logger.warn('v2', 'Failed to load v2.0 processor, will use v1.0 only', { error: error.message });
  });
} catch (error: any) {
  logger.warn('v2', 'v2.0 processor import failed', { error: error.message });
}

// 监听扩展安装
chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('install', `Extension installed: ${details.reason}`);
  
  if (details.reason === 'install') {
    // 初始化数据库
    await initializeDatabase();
    
    // 打开欢迎页
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/ui/options/index.html'),
    });
  }
});

// 监听来自 popup/options/content-script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.debug('message', `Received message: ${message.type}`, { message, sender });
  
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      logger.error('message', 'Message handling failed', { error });
      sendResponse({ error: error.message });
    });
  
  // 返回 true 表示异步响应
  return true;
});

// 监听定时器（用于排期发布）
chrome.alarms.onAlarm.addListener(async (alarm) => {
  logger.info('alarm', `Alarm triggered: ${alarm.name}`);
  
  if (alarm.name === 'check-scheduled-jobs') {
    await processScheduledJobs();
  }
});

// 设置定时检查排期任务（每分钟检查一次）
chrome.alarms.create('check-scheduled-jobs', {
  periodInMinutes: 1,
});

/**
 * 初始化数据库
 */
async function initializeDatabase() {
  logger.info('init', 'Initializing database');
  
  try {
    // 测试数据库连接
    await db.open();
    logger.info('init', 'Database initialized successfully');
  } catch (error) {
    logger.error('init', 'Database initialization failed', { error });
  }
}

/**
 * 保存采集的文章到数据库（v2.0 增强版）
 */
async function saveCollectedPost(data: any) {
  try {
    const now = Date.now();
    const id = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2, 8)}`;

    let v2Enhanced = null;
    
    // 🚀 尝试使用 v2.0 处理器增强内容（如果可用）
    if (data?.body_html && processCollectedHTML) {
      logger.info('v2', 'Processing content with v2.0 pipeline');
      
      try {
        const v2Result = await processCollectedHTML(
          data.body_html,
          { 
            title: data.title || '未命名标题', 
            url: data.url || '' 
          },
          {
            downloadImages: true,
            platforms: ['juejin', 'csdn', 'zhihu', 'wechat'],
            onProgress: (stage: string, progress: number) => {
              logger.debug('v2-progress', `${stage}: ${(progress * 100).toFixed(0)}%`);
            },
          }
        );

        if (v2Result.success && v2Result.data) {
          v2Enhanced = v2Result.data;
          logger.info('v2', 'v2.0 processing successful', {
            imageCount: v2Enhanced.manifest.images.length,
            formulaCount: v2Enhanced.manifest.formulas.length,
            platforms: Object.keys(v2Enhanced.adaptedContent).length,
          });
        }
      } catch (error: any) {
        logger.warn('v2', 'v2.0 processing failed, falling back to v1.0', { error: error.message });
      }
    } else if (data?.body_html && !processCollectedHTML) {
      logger.info('v2', 'v2.0 processor not loaded, using v1.0');
    }

    // 构建资产列表（优先使用 v2.0 的增强数据）
    const assets = v2Enhanced?.manifest.images.map((img: any, idx: number) => ({
      id: `${id}-img-${idx}`,
      type: 'image',
      url: img.proxyUrl || img.originalUrl,
      alt: img.metadata?.alt,
      title: img.metadata?.title,
      width: img.metadata?.width,
      height: img.metadata?.height,
      hash: img.id,
      variants: img.optimized ? {
        webp: img.optimized.webp?.url,
      } : undefined,
    })) || (Array.isArray(data?.images)
      ? data.images.map((img: any, idx: number) => ({
          id: `${id}-img-${idx}`,
          type: 'image',
          url: img?.url || '',
          alt: img?.alt || undefined,
          title: img?.title || undefined,
          width: img?.width || undefined,
          height: img?.height || undefined,
        }))
      : []);

    const post = {
      id,
      version: v2Enhanced ? 2 : 1, // 标记版本
      title: data?.title || '未命名标题',
      summary: v2Enhanced?.metadata ? 
        (data.summary || `${v2Enhanced.metadata.wordCount} 字，${v2Enhanced.metadata.imageCount} 图`) :
        (data?.summary || ''),
      canonicalUrl: data?.url || '',
      createdAt: now,
      updatedAt: now,
      body_md: v2Enhanced?.markdown || data?.body_md || '',
      tags: [],
      categories: [],
      assets,
      meta: {
        source_url: data?.url || '',
        collected_at: new Date(now).toISOString(),
        body_html: data?.body_html || '',
        // v2.0 增强数据
        ...(v2Enhanced ? {
          v2: {
            ast: v2Enhanced.ast,
            manifest: v2Enhanced.manifest,
            adaptedContent: v2Enhanced.adaptedContent,
            metadata: v2Enhanced.metadata,
          },
        } : {}),
      },
    } as any;

    await db.posts.add(post);
    
    logger.info('db', 'Post saved', { 
      id: post.id, 
      title: post.title, 
      version: post.version,
      len: post.body_md?.length || 0,
      images: assets.length,
      v2Enhanced: !!v2Enhanced,
    });
    
    return { 
      success: true, 
      postId: post.id,
      v2Enhanced: !!v2Enhanced,
    };
  } catch (error: any) {
    logger.error('db', 'Save post failed', { error });
    return { success: false, error: error?.message || 'Save failed' };
  }
}

/**
 * 处理消息
 */
async function handleMessage(message: any, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'CREATE_JOB':
      return await createJob(message.data);
    
    case 'START_JOB':
      return await startJob(message.data.jobId);
    
    case 'CANCEL_JOB':
      return await cancelJob(message.data.jobId);
    
    case 'GET_JOB_STATUS':
      return await getJobStatus(message.data.jobId);
    
    case 'COLLECT_CONTENT':
      // 请求 content script 采集内容
      if (sender.tab?.id) {
        return await collectContentFromTab(sender.tab.id);
      }
      throw new Error('No tab context');

    case 'SAVE_POST':
      // 保存采集结果到本地数据库
      logger.info('save', 'Saving post', { title: message.data?.title });
      try {
        const result = await saveCollectedPost(message.data);
        logger.info('save', 'Save result', result);
        return result;
      } catch (error: any) {
        logger.error('save', 'Save failed', { error });
        return { success: false, error: error.message };
      }

    case 'CONTENT_COLLECTED':
      // 内容采集完成的通知
      logger.info('collect', 'Content collected successfully', message.data);
      
      let saved: any = { success: false };
      if (message.data?.success && message.data?.data) {
        // 保存文章
        saved = await saveCollectedPost(message.data.data);
        
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icon-48.png',
          title: saved.success ? '采集成功并已保存' : '采集成功但保存失败',
          message: `文章：${message.data.data?.title || '未知标题'}`,
        });
      }
      
      return { received: true, saved };
    
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * 创建发布任务
 */
async function createJob(data: { postId: string; targets: any[] }) {
  logger.info('job', `Creating job for post: ${data.postId}`);
  
  const job: Job = {
    id: crypto.randomUUID(),
    postId: data.postId,
    targets: data.targets,
    state: 'PENDING',
    progress: 0,
    attempts: 0,
    maxAttempts: 3,
    logs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  await db.jobs.add(job);
  logger.info('job', `Job created: ${job.id}`);
  
  return { jobId: job.id };
}

/**
 * 启动任务
 */
async function startJob(jobId: string) {
  logger.info('job', `Starting job: ${jobId}`);
  
  const job = await db.jobs.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  
  if (job.state !== 'PENDING') {
    throw new Error(`Job is not in PENDING state: ${job.state}`);
  }
  
  // 更新状态为 RUNNING
  await db.jobs.update(jobId, {
    state: 'RUNNING',
    updatedAt: Date.now(),
  });
  
  // 在后台执行任务
  executeJob(jobId).catch((error) => {
    logger.error('job', `Job execution failed: ${jobId}`, { error });
  });
  
  return { success: true };
}

/**
 * 取消任务
 */
async function cancelJob(jobId: string) {
  logger.info('job', `Cancelling job: ${jobId}`);
  
  await db.jobs.update(jobId, {
    state: 'PAUSED',
    updatedAt: Date.now(),
  });
  
  return { success: true };
}

/**
 * 获取任务状态
 */
async function getJobStatus(jobId: string) {
  const job = await db.jobs.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    logs: job.logs,
  };
}

/**
 * 执行任务
 */
async function executeJob(jobId: string) {
  const job = await db.jobs.get(jobId);
  if (!job) {
    logger.error('job', `Job not found: ${jobId}`);
    return;
  }
  
  const post = await db.posts.get(job.postId);
  if (!post) {
    logger.error('job', `Post not found: ${job.postId}`);
    await db.jobs.update(jobId, {
      state: 'FAILED',
      error: 'Post not found',
      updatedAt: Date.now(),
    });
    return;
  }
  
  logger.info('job', `Executing job: ${jobId}`, { targets: job.targets.length });
  
  try {
    for (let i = 0; i < job.targets.length; i++) {
      const target = job.targets[i];
      const progress = (i / job.targets.length) * 100;
      
      await db.jobs.update(jobId, {
        progress,
        updatedAt: Date.now(),
      });
      
      logger.info('job', `Publishing to ${target.platform}`, { jobId, target });
      
      // TODO: 实现平台发布逻辑
      // const adapter = getAdapter(target.platform);
      // const result = await adapter.publish(...);
      
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 模拟延迟
    }
    
    // 任务完成
    await db.jobs.update(jobId, {
      state: 'DONE',
      progress: 100,
      updatedAt: Date.now(),
    });
    
    logger.info('job', `Job completed: ${jobId}`);
    
    // 发送通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
      title: 'SyncCaster',
      message: `文章《${post.title}》发布完成`,
    });
  } catch (error: any) {
    logger.error('job', `Job failed: ${jobId}`, { error });
    
    await db.jobs.update(jobId, {
      state: 'FAILED',
      error: error.message,
      updatedAt: Date.now(),
    });
  }
}

/**
 * 处理排期任务
 */
async function processScheduledJobs() {
  const now = Date.now();
  const jobs = await db.jobs
    .where('state')
    .equals('PENDING')
    .and((job) => !!job.scheduleAt && job.scheduleAt <= now)
    .toArray();
  
  logger.info('scheduler', `Found ${jobs.length} scheduled jobs`);
  
  for (const job of jobs) {
    await startJob(job.id);
  }
}

/**
 * 从标签页采集内容
 */
async function collectContentFromTab(tabId: number) {
  logger.info('collect', `Collecting content from tab: ${tabId}`);
  
  const result = await chrome.tabs.sendMessage(tabId, {
    type: 'COLLECT_CONTENT',
  });
  
  return result;
}

logger.info('startup', 'Background service worker started');
