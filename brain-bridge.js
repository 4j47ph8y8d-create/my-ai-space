// brain-bridge.js — 后端到本地大脑(127.0.0.1:8765)的桥接
// 职责：按 用户ID:角色ID 建档、检索相关记忆、读取情绪/关系状态、手动同步既有记忆。
// 大脑仅做检索增强；回复仍由前端直连 DeepSeek 生成。大脑不可用时静默降级，不阻断聊天。
const crypto = require('crypto');
const BRAIN_URL = (process.env.BRAIN_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');
const BRAIN_TOKEN = process.env.BRAIN_TOKEN || '';
const TIMEOUT_MS = 3000;

async function request(action, method, body, query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let url = BRAIN_URL + '/api/' + action;
    if (query) url += '?' + new URLSearchParams(query).toString();
    const headers = { 'Authorization': 'Bearer ' + BRAIN_TOKEN };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const resp = await fetch(url, { method, headers, body: payload, signal: ctrl.signal });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!resp.ok) {
      const err = new Error('brain ' + action + ' HTTP ' + resp.status);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const brainGet = (action, query) => request(action, 'GET', undefined, query);
const brainPost = (action, body) => request(action, 'POST', body);

// 角色是否已在大脑中建档（不存在返回 404）
async function characterExists(characterId) {
  try {
    await brainGet('conversation', { character_id: characterId });
    return true;
  } catch (e) {
    return e.status === 404 ? false : true; // 其他异常按已存在处理，避免重复建档刷屏
  }
}

// 确保角色已建档；已存在则跳过
async function ensureCharacter(characterId, name, persona) {
  if (await characterExists(characterId)) return { created: false };
  const spec = {
    id: characterId,
    name: String(name || 'AI 伴侣').slice(0, 100),
    persona: String(persona || '一个温柔体贴的人').slice(0, 16000),
    relationship_enabled: true,
    romance_enabled: false,
    memory_policy: 'automatic',
    timezone: 'Asia/Shanghai'
  };
  await brainPost('create_character', { spec });
  return { created: true };
}

// 取大脑上下文：相关记忆文本列表 + 情绪/关系 note
async function getContext(characterId, query) {
  const result = { memories: [], emotionNote: null, degraded: false };

  try {
    const recall = await brainPost('recall', {
      character_id: characterId,
      query: String(query || '').slice(0, 16000)
    });
    const sources = Array.isArray(recall.sources) ? recall.sources : [];
    sources.forEach(s => {
      const t = (s.text || '').trim();
      if (t && !result.memories.includes(t)) result.memories.push(t);
    });
  } catch (e) {
    result.degraded = true;
  }

  // facts 层检索（灌入的既有记忆，走 memory_search FTS）
  try {
    const sr = await brainPost('search', {
      character_id: characterId,
      query: String(query || '').slice(0, 16000)
    });
    const facts = Array.isArray(sr.memories) ? sr.memories : [];
    facts.forEach(f => {
      const t = (f.text || '').trim();
      if (t && !result.memories.includes(t)) result.memories.push(t);
    });
  } catch (e) {
    result.degraded = true;
  }

  result.memories = result.memories.slice(0, 8);

  try {
    const conv = await brainGet('conversation', { character_id: characterId });
    const rel = conv && conv.relationship;
    if (rel && rel.enabled && rel.note) result.emotionNote = rel.note;
  } catch (e) {
    result.degraded = true;
  }

  return result;
}

// 手动写入一条记忆（引擎 remember，不要求对话轮次；幂等：同 key 同内容 Reinforce）
async function rememberMemory(characterId, draft) {
  await brainPost('remember', { character_id: characterId, draft });
}

// 用一条 Appraisal 推进大脑情绪/关系状态；返回大脑最新 state/note。失败由调用方降级处理。
async function applyAppraisal(characterId, appraisal) {
  return await brainPost('appraise', { character_id: characterId, appraisal });
}

// 把宿主既有记忆（[{text, level}]）幂等灌入大脑；逐条失败不阻断其余
async function syncMemories(characterId, memList) {
  const added = [];
  const skipped = [];
  const list = Array.isArray(memList) ? memList : [];
  for (const m of list) {
    const text = String((m && m.text) || '').trim();
    if (!text) continue;
    const key = 'mem_' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
    const category = (m && m.level === 'core') ? 'identity' : 'preference';
    const clipped = text.slice(0, 2000);
    try {
      await rememberMemory(characterId, {
        key,
        text: clipped,
        category,
        source_quote: clipped
      });
      added.push(key);
    } catch (e) {
      skipped.push(key);
    }
  }
  return { added: added.length, skipped: skipped.length };
}

module.exports = { ensureCharacter, getContext, brainGet, brainPost, rememberMemory, syncMemories, applyAppraisal };
