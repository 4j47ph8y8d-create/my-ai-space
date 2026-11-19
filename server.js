const https = require('https');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-me';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
// 托管前端静态文件（让域名能直接打开网页）
// app.use(express.static('/var/www/my-ai-space')); // disabled: causes stale files
app.use(express.static(__dirname));

const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI || 'mongodb://localhost:27017/dream_app', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB 连接成功'))
.catch(err => {
    console.error('❌ MongoDB 连接失败:', err.message);
});

// ===== 用户模型 =====
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    nickname: { type: String, default: '' },
    resetCode: { type: String, default: '' },
    resetCodeExpires: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const bcrypt = require('bcryptjs');
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

UserSchema.methods.comparePassword = async function(password) {
    const bcrypt = require('bcryptjs');
    return await bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', UserSchema);

// ===== 邮件发送器 =====
const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});


// ===== 用户数据模型（禁用乐观锁版本控制） =====
const UserDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    roles: { type: mongoose.Schema.Types.Mixed, default: [] },
    diaries: { type: mongoose.Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });  // ← 关键修复：禁用 __v

const UserData = mongoose.model('UserData', UserDataSchema);

// ===== 邀请码模型 =====
const InviteCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    used: { type: Boolean, default: false },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    usedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null }
});

const InviteCode = mongoose.model('InviteCode', InviteCodeSchema);

// ===== 身份验证中间件 =====
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未认证，请先登录' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: '登录已过期，请重新登录' });
        }
        return res.status(401).json({ error: '无效的 token' });
    }
}

// ============================================================
//  📡 路由
// ============================================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: '服务器运行正常' });
});

app.get('/', (req, res) => {
    res.redirect('/index.html');
});

// ============================================================
//  🔑 邀请码系统
// ============================================================

app.post('/api/invite/generate', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({ success: false, error: '用户不存在' });
        }

        const ADMIN_EMAIL = '2277205709@qq.com';
        if (user.email !== ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: '只有管理员可以生成邀请码' });
        }

        const { password } = req.body;
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
        if (!ADMIN_PASSWORD) {
            return res.status(500).json({ success: false, error: '管理员密码未配置' });
        }
        if (password !== ADMIN_PASSWORD) {
            return res.status(403).json({ success: false, error: '管理员密码错误' });
        }

        function generateCode() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
            return code.slice(0, 4) + '-' + code.slice(4, 8);
        }

        let code = generateCode();
        let exists = await InviteCode.findOne({ code });
        while (exists) {
            code = generateCode();
            exists = await InviteCode.findOne({ code });
        }

        const inviteCode = new InviteCode({
            code: code,
            createdBy: userId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });
        await inviteCode.save();

        res.json({
            success: true,
            code: code,
            expiresAt: inviteCode.expiresAt
        });

    } catch (error) {
        console.error('生成邀请码错误:', error);
        res.status(500).json({ success: false, error: '生成失败，请重试' });
    }
});

app.post('/api/invite/verify', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.json({ valid: false, error: '请输入邀请码' });
        }

        const inviteCode = await InviteCode.findOne({ code });
        if (!inviteCode) {
            return res.json({ valid: false, error: '邀请码不存在' });
        }
        if (inviteCode.used) {
            return res.json({ valid: false, error: '该邀请码已被使用' });
        }
        if (inviteCode.expiresAt && new Date() > inviteCode.expiresAt) {
            return res.json({ valid: false, error: '邀请码已过期' });
        }

        res.json({ valid: true, message: '邀请码有效' });

    } catch (error) {
        console.error('验证邀请码错误:', error);
        res.status(500).json({ valid: false, error: '验证失败' });
    }
});

// ===== 注册（修复版） =====
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, nickname, inviteCode } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少 6 位' });
        }

        const ADMIN_EMAIL = '2277205709@qq.com';
        const isAdmin = email === ADMIN_EMAIL;

        // ===== 如果是普通用户，先验证邀请码（但不消耗） =====
        let usedCode = null;
        if (!isAdmin) {
            if (!inviteCode) {
                return res.status(400).json({ error: '🔑 请输入邀请码' });
            }

            usedCode = await InviteCode.findOne({ code: inviteCode });
            if (!usedCode) {
                return res.status(400).json({ error: '邀请码不存在' });
            }
            if (usedCode.used) {
                return res.status(400).json({ error: '该邀请码已被使用' });
            }
            if (usedCode.expiresAt && new Date() > usedCode.expiresAt) {
                return res.status(400).json({ error: '邀请码已过期' });
            }
        }

        // ===== 检查邮箱是否已注册 =====
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: '该邮箱已注册' });
        }

        // ===== 创建用户（先创建，拿到 _id） =====
        const user = new User({ email, password, nickname });
        await user.save();

        // ===== 如果是普通用户，标记邀请码为已使用（此时 user._id 已存在） =====
        if (!isAdmin && usedCode) {
            usedCode.used = true;
            usedCode.usedBy = user._id;
            usedCode.usedAt = new Date();
            await usedCode.save();
        }

        // ===== 创建用户数据 =====
        const userData = new UserData({ userId: user._id });
        await userData.save();

        const role = isAdmin ? 'admin' : 'user';

        res.json({
            success: true,
            message: isAdmin ? '✅ 管理员注册成功！' : '✅ 注册成功！',
            user: { id: user._id, email: user.email, nickname: user.nickname, role: role }
        });

    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// ===== 登录 =====
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: '账号或密码错误' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: '账号或密码错误' });
        }

        const ADMIN_EMAIL = '2277205709@qq.com';
        const role = (email === ADMIN_EMAIL) ? 'admin' : 'user';

        const token = jwt.sign(
            { userId: user._id.toString(), email: user.email, role: role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token: token,
            user: {
                id: user._id,
                email: user.email,
                nickname: user.nickname || email.split('@')[0],
                role: role
            }
        });

    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// ===== 忘记密码：请求验证码 =====
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: '请填写邮箱' });

        const user = await User.findOne({ email: String(email).toLowerCase() });
        // 无论用户是否存在，都返回成功，避免暴露注册状态
        if (!user) {
            return res.json({ success: true });
        }

        const code = String(Math.floor(100000 + Math.random() * 900000));
        user.resetCode = code;
        user.resetCodeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟
        await user.save();

        await mailer.sendMail({
            from: '"LunarReverie" <' + process.env.SMTP_USER + '>',
            to: user.email,
            subject: '【LunarReverie】密码重置验证码',
            text: '你的验证码是：' + code + '，10 分钟内有效。如果这不是你本人操作，请忽略这封邮件。',
            html: '<p>你的验证码是：<b style="font-size:18px;">' + code + '</b></p><p>10 分钟内有效。如果这不是你本人操作，请忽略这封邮件。</p>'
        });

        res.json({ success: true });
    } catch (error) {
        console.error('发送验证码失败:', error);
        res.status(500).json({ error: '发送失败，请稍后重试' });
    }
});

// ===== 忘记密码：重置密码 =====
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        if (!email || !code || !newPassword) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        if (String(newPassword).length < 6) {
            return res.status(400).json({ error: '密码至少 6 位' });
        }

        const user = await User.findOne({ email: String(email).toLowerCase() });
        if (!user) return res.status(400).json({ error: '验证码错误或已过期' });
        if (!user.resetCode || user.resetCode !== String(code)) {
            return res.status(400).json({ error: '验证码错误或已过期' });
        }
        if (!user.resetCodeExpires || user.resetCodeExpires.getTime() < Date.now()) {
            return res.status(400).json({ error: '验证码错误或已过期' });
        }

        user.password = newPassword;
        user.resetCode = '';
        user.resetCodeExpires = null;
        await user.save();

        res.json({ success: true });
    } catch (error) {
        console.error('重置密码失败:', error);
        res.status(500).json({ error: '重置失败，请稍后重试' });
    }
});

// ===== 保存数据（修复版） =====
function mergeRoleMem(oldRole, newRole) {
    var oldT = Array.isArray(oldRole.memoryTombstones) ? oldRole.memoryTombstones : [];
    var newT = Array.isArray(newRole.memoryTombstones) ? newRole.memoryTombstones : [];
    // 显式恢复列表：仅本次主动恢复的文本，才从删除标记中移除
    var restoreSet = new Set((Array.isArray(newRole.memoryRestored) ? newRole.memoryRestored : []).filter(function (x) { return typeof x === 'string' && x; }));
    var tombSet = new Set(oldT.concat(newT).filter(function (x) { return typeof x === 'string' && x; }));
    var map = new Map();
    var order = [];
    function add(m, isNew) {
        if (!m || typeof m.text !== 'string' || !m.text) return;
        if (tombSet.has(m.text)) return;
        if (map.has(m.text)) {
            var old = map.get(m.text);
            if (isNew && m.level === 'core' && old.level !== 'core') map.set(m.text, m);
        } else { map.set(m.text, m); order.push(m.text); }
    }
    (oldRole.memory || []).forEach(function (m) { add(m, false); });
    (newRole.memory || []).forEach(function (m) { add(m, true); });
    // 不再因新快照现存某条就自动抹除删除标记；只清理显式恢复的文本
    restoreSet.forEach(function (t) { tombSet.delete(t); });
    return {
        memory: order.map(function (t) { return map.get(t); }),
        memoryTombstones: Array.from(tombSet)
    };
}
// ===== 记忆期限兜底清扫（后端执行，不依赖前端页面是否打开） =====
const MEMORY_RULES = {
    RECENT_TO_ARCHIVE_DAYS: 30,
    ARCHIVE_TO_DELETE_DAYS: 45
};
function pruneRoleMemory(role) {
    if (!role || typeof role !== 'object') return role;
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const mem = Array.isArray(role.memory) ? role.memory : [];
    const kept = [];
    mem.forEach((m) => {
        if (!m || typeof m.text !== 'string' || !m.text) return;
        const level = m.level || 'core';
        // 核心记忆永久保留
        if (level === 'core') { kept.push(m); return; }
        let t = typeof m.timestamp === 'number' ? m.timestamp : Date.parse(m.timestamp);
        if (!t || isNaN(t)) { kept.push(m); return; } // 无有效时间戳，不误删
        const ageDays = (now - t) / DAY;
        if (level === 'recent') {
            if (ageDays > MEMORY_RULES.RECENT_TO_ARCHIVE_DAYS) m.level = 'archived';
            kept.push(m); return;
        }
        // archived 与历史旧命名 archive 视同归档，到期直接物理删除
        if (level === 'archived' || level === 'archive') {
            if (ageDays > MEMORY_RULES.ARCHIVE_TO_DELETE_DAYS) return;
            kept.push(m); return;
        }
        kept.push(m);
    });
    role.memory = kept;
    // 回收删除标记：对应记忆已不在库中的，标记本身一并清掉，不长期占库
    const memTexts = new Set(kept.map((m) => m.text));
    const tomb = Array.isArray(role.memoryTombstones) ? role.memoryTombstones : [];
    role.memoryTombstones = tomb.filter((t) => typeof t === 'string' && memTexts.has(t));
    return role;
}

app.post('/api/data/save', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        let { config, roles, diaries } = req.body;
        console.log('[SAVE] 收到 userId=' + userId + ' roles=' + (Array.isArray(roles) ? roles.length : '非数组') + ' 记忆=' + (Array.isArray(roles) ? roles.map(function (r) { return (r && r.id || '?') + ':' + (r && r.memory ? r.memory.length : 0); }).join(',') : '-'));

        // 清理可能携带的 __v 字段
        if (config && typeof config === 'object') {
            delete config.__v;
        }
        if (roles && Array.isArray(roles)) {
            roles = roles.map(r => {
                if (r && typeof r === 'object') delete r.__v;
                return r;
            });
        }
        if (diaries && Array.isArray(diaries)) {
            diaries = diaries.map(d => {
                if (d && typeof d === 'object') delete d.__v;
                return d;
            });
        }

        let userData = await UserData.findOne({ userId });
        const existingRoles = userData && Array.isArray(userData.roles) ? userData.roles : [];
        if (Array.isArray(roles)) {
            roles = roles.map(function (r) {
                if (!r || typeof r !== 'object') return r;
                const old = existingRoles.find(function (x) { return x && x.id === r.id; });
                if (old) {
                    const merged = mergeRoleMem(old, r);
                    r.memory = merged.memory;
                    r.memoryTombstones = merged.memoryTombstones;
                } else if (!Array.isArray(r.memoryTombstones)) {
                    r.memoryTombstones = [];
                }
                pruneRoleMemory(r); // 后端兜底：期限清扫 + 标记回收
                return r;
            });
        }
        if (userData) {
            userData.config = config || userData.config;
            userData.roles = roles || userData.roles;
            userData.diaries = diaries || userData.diaries;
            userData.updatedAt = new Date();
            await userData.save();
        } else {
            userData = new UserData({ userId, config, roles, diaries });
            await userData.save();
        }
        console.log('[SAVE] 保存成功 version=' + (userData.version || 1));
        if (userData && Array.isArray(userData.roles)) { console.log('[SAVE] 落库记忆=' + userData.roles.map(function (r) { return (r && r.id || '?') + ':' + (r && Array.isArray(r.memory) ? r.memory.length : 0); }).join(',')); }
        res.json({ success: true, version: userData.version || 1 });
    } catch (error) {
        console.error('保存数据错误:', error);
        res.status(500).json({ error: '数据保存失败: ' + error.message });
    }
});

// ===== 加载数据 =====
app.get('/api/data/load', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const userData = await UserData.findOne({ userId });
        if (!userData) {
            return res.json({ success: true, data: null, version: 0 });
        }
        res.json({
            success: true,
            data: {
                config: userData.config || {},
                roles: userData.roles || [],
                diaries: userData.diaries || []
            },
            version: userData.version || 1
        });
    } catch (error) {
        console.error('加载数据错误:', error);
        res.status(500).json({ error: '数据加载失败' });
    }
});

app.get('/api/test', (req, res) => {
    res.json({ message: '后端连接成功！' });
});

const httpsOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/lunar-reverie.top/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/lunar-reverie.top/fullchain.pem')
};

// 保持原来的 3000 端口（内网/测试用）
app.listen(3000, () => {
  console.log('HTTP Server running on port 3000');
});

// 新增 HTTPS 443 端口（对外服务）
https.createServer(httpsOptions, app).listen(443, () => {
  console.log('HTTPS Server running on port 443');
});
app.post('/api/save_memory', authenticate, async (req, res) => { const { characterId, memoryText } = req.body; const userId = req.userId; const { syncMemory } = require('./sync-brain.js'); try { const result = await syncMemory(userId, characterId, memoryText); res.json({ success: true, result: result }); } catch(e) { res.json({ success: false, error: e.message }); } });
// 大脑上下文桥接：检索该角色相关记忆 + 情绪/关系状态（只读；大脑不可用则降级为空，不阻断聊天）
app.get('/api/brain/context', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const roleId = req.query.roleId;
        const message = String(req.query.message || '').slice(0, 16000);
        if (!roleId) return res.json({ success: true, memories: [], emotionNote: null, degraded: true });
        const userData = await UserData.findOne({ userId });
        const role = (userData && Array.isArray(userData.roles) ? userData.roles : []).find(r => r && r.id === roleId);
        const characterId = userId + ':' + roleId;
        const name = role ? role.name : 'AI 伴侣';
        const persona = role ? [role.persona, role.background, role.style, role.extra].filter(Boolean).join('\n') : '';
        const { ensureCharacter, getContext, brainGet, syncMemories } = require('./brain-bridge.js');
        try { await ensureCharacter(characterId, name, persona); } catch (e) { console.error('[BRAIN] 建档失败:', e.message); }
        // 首次进入时把 MongoDB 既有记忆幂等灌入大脑（大脑该角色记忆为空才灌，避免每轮重复）
        try {
            const memList = Array.isArray(role && role.memory) ? role.memory : [];
            if (memList.length) {
                const conv = await brainGet('conversation', { character_id: characterId });
                const existing = Array.isArray(conv && conv.memories) ? conv.memories.length : 0;
                if (existing === 0) {
                    const synced = await syncMemories(characterId, memList);
                    console.log('[BRAIN] 记忆灌入 ' + characterId + ' added=' + synced.added + ' skipped=' + synced.skipped);
                }
            }
        } catch (e) { console.error('[BRAIN] 记忆同步失败:', e.message); }
        const ctx = await getContext(characterId, message);
        res.json({ success: true, memories: ctx.memories, emotionNote: ctx.emotionNote, degraded: ctx.degraded });
    } catch (e) {
        res.json({ success: true, memories: [], emotionNote: null, degraded: true });
    }
});
