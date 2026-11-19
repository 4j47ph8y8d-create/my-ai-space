// appraisal-rules.js — 第一版本地规则：把一轮对话映射成大脑 Appraisal。
// 不新增对外模型调用；规则保守、单次幅度小，避免情绪/关系轴剧烈跳变。
// 后续可升级为模型评估。

// 情绪关键词：按优先级从上到下，首个命中即定 emotion。w=命中权重（影响强度）。
const EMOTION_RULES = [
  { emotion: 'hurt', words: ['委屈', '受伤', '心疼', '失望', '被忽略', '敷衍我', '不在乎我', '眼泪', '哭了', '哭出来'], w: 2 },
  { emotion: 'sad', words: ['难过', '伤心', '沮丧', '心累', '疲惫', '好累', '累了', '压力大', '压力好大', '不想说话', '孤独', '孤单', '寂寞', '失落', '空虚', '没力气', 'emo', '低落'], w: 1 },
  { emotion: 'annoyed', words: ['生气', '烦死', '讨厌', '不理我', '好凶', '骂', '吵架', '分手', '恶心', '抱怨', '烦死了'], w: 1 },
  { emotion: 'anxious', words: ['紧张', '不安', '害怕', '担心', '焦虑', '心慌', '吃醋', '嫉妒', '没安全感', '怕失去', '忐忑', '睡不着'], w: 1 },
  { emotion: 'guarded', words: ['你是谁', '凭什么', '不信任', '不想说', '别问了'], w: 1 },
  { emotion: 'tender', words: ['想你', '想念', '喜欢', '爱你', '宝贝', '亲爱的', '抱抱', '亲亲', '乖', '陪伴', '心疼你', '抱抱你'], w: 2 },
  { emotion: 'warm', words: ['谢谢', '感动', '温暖', '贴心', '辛苦', '感恩', '谢谢你'], w: 1 },
  { emotion: 'playful', words: ['逗你', '调皮', '开玩笑', '闹着玩', '卖萌', '耍宝', '嘻嘻'], w: 1 },
  { emotion: 'flustered', words: ['害羞', '脸红', '不好意思', '被撩', '心跳加速', '捂脸'], w: 1 },
  { emotion: 'happy', words: ['开心', '高兴', '哈哈', '嘿嘿', '太好了', '棒', '幸福', '满足', '兴奋', '耶'], w: 1 },
  { emotion: 'curious', words: ['为什么', '怎么', '是什么', '讲讲', '说说', '吗？', '呢？'], w: 0 }
];

// 各情绪默认带来的关系轴变化（Delta -3..3，第一版幅度克制）。
const AXIS_BY_EMOTION = {
  calm: {},
  curious: { trust: 1 },
  happy: { warmth: 1, trust: 1 },
  warm: { warmth: 1, trust: 1 },
  tender: { warmth: 2, trust: 1, romance: 1, disclosure: 1 },
  playful: { warmth: 1 },
  flustered: { warmth: 1, tension: 1 },
  hurt: { tension: 1, warmth: -1 },
  sad: { tension: 1 },
  guarded: { tension: 1, trust: -1 },
  annoyed: { tension: 2, warmth: -1, trust: -1 },
  anxious: { tension: 2 }
};

// 主动披露近况/心事的信号词（提升 disclosure）。
const DISCLOSURE_WORDS = ['今天', '最近', '我吃了', '我在', '我工作', '上班', '下班', '我身体', '感冒', '生病', '我心情', '家里', '朋友', '睡觉', '月经', '姨妈', '胃疼', '累了'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// message: 用户本轮发言；reply: AI 回复（第一版主要用 message，reply 留作后续）。
function evaluateAppraisal(message, _reply) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  let emotion = 'calm';
  let weight = 0;
  for (const rule of EMOTION_RULES) {
    const hit = rule.words.some(w => lower.includes(w.toLowerCase()));
    if (hit) { emotion = rule.emotion; weight = rule.w; break; }
  }

  // 强度：命中权重 + 感叹号/重复标点；clamp 0..3
  const exclaim = (text.match(/[！!]{2,}/g) || []).length;
  let intensity = weight + exclaim;
  if (text.length > 40) intensity += 1;
  intensity = clamp(intensity, 0, 3);

  const axes = Object.assign({}, AXIS_BY_EMOTION[emotion] || {});

  // 主动披露：含近况信号词，disclosure +1（已含 tender 的话不重复加）
  const disclosed = DISCLOSURE_WORDS.some(w => lower.includes(w));
  if (disclosed) axes.disclosure = clamp((axes.disclosure || 0) + 1, 0, 3);
  if (!('disclosure' in axes)) axes.disclosure = 0;

  // 轴值 clamp -3..3 / 0..3
  const trust = clamp(axes.trust || 0, -3, 3);
  const warmth = clamp(axes.warmth || 0, -3, 3);
  const tension = clamp(axes.tension || 0, -3, 3);
  const romance = clamp(axes.romance || 0, -3, 3);
  const disclosure = clamp(axes.disclosure || 0, 0, 3);

  const sourceQuote = text.slice(0, 2000) || '(no message)';

  return {
    emotion,
    intensity,
    trust,
    warmth,
    tension,
    romance,
    disclosure,
    source_quote: sourceQuote
  };
}

module.exports = { evaluateAppraisal };
