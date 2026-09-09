const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-me';

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ===== 连接 MongoDB =====
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

// ===== 用户数据模型 =====
const UserDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    roles: { type: mongoose.Schema.Types.Mixed, default: [] },
    diaries: { type: mongoose.Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now }
});

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

// ===== 生成邀请码（仅管理员） =====
app.post('/api/invite/generate', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({ success: false, error: '用户不存在' });
        }

        // ===== 硬编码管理员邮箱（已改成你的） =====
        const ADMIN_EMAIL = '2277205709@qq.com';
        if (user.email !== ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: '只有管理员可以生成邀请码' });
        }

        // ===== 验证管理员密码 =====
        const { password } = req.body;
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
        if (!ADMIN_PASSWORD) {
            return res.status(500).json({ success: false, error: '管理员密码未配置' });
        }
        if (password !== ADMIN_PASSWORD) {
            return res.status(403).json({ success: false, error: '管理员密码错误' });
        }

        // ===== 生成邀请码 =====
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

        // ===== 保存邀请码 =====
        const inviteCode = new InviteCode({
            code: code,
            createdBy: userId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天后过期
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

// ===== 验证邀请码（注册前检查） =====
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

// ===== 注册 =====
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, nickname, inviteCode } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少 6 位' });
        }

        // ===== 硬编码管理员邮箱（已改成你的） =====
        const ADMIN_EMAIL = '2277205709@qq.com';
        const isAdmin = email === ADMIN_EMAIL;

        // ===== 如果是普通用户，验证邀请码 =====
        if (!isAdmin) {
            if (!inviteCode) {
                return res.status(400).json({ error: '🔑 请输入邀请码' });
            }

            const existingCode = await InviteCode.findOne({ code: inviteCode });
            if (!existingCode) {
                return res.status(400).json({ error: '邀请码不存在' });
            }
            if (existingCode.used) {
                return res.status(400).json({ error: '该邀请码已被使用' });
            }
            if (existingCode.expiresAt && new Date() > existingCode.expiresAt) {
                return res.status(400).json({ error: '邀请码已过期' });
            }

            // 标记邀请码为已使用
            existingCode.used = true;
            existingCode.usedBy = user._id; // 注意：此时 user 还没创建，后面再补上
            existingCode.usedAt = new Date();
            await existingCode.save();
        }

        // ===== 检查邮箱是否已注册 =====
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: '该邮箱已注册' });
        }

        // ===== 创建用户 =====
        const user = new User({ email, password, nickname });
        await user.save();

        // ===== 如果是普通用户，补上邀请码的使用者 =====
        if (!isAdmin && inviteCode) {
            const usedCode = await InviteCode.findOne({ code: inviteCode });
            if (usedCode) {
                usedCode.usedBy = user._id;
                await usedCode.save();
            }
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

        // ===== 硬编码管理员邮箱（已改成你的） =====
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
                role: role  // ← 关键：返回管理员角色
            }
        });

    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// ===== 保存数据 =====
app.post('/api/data/save', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { config, roles, diaries } = req.body;
        let userData = await UserData.findOne({ userId });
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
        res.json({ success: true, version: userData.version || 1 });
    } catch (error) {
        console.error('保存数据错误:', error);
        res.status(500).json({ error: '数据保存失败' });
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
                config: userData.config,
                roles: userData.roles,
                diaries: userData.diaries
            },
            version: userData.version
        });
    } catch (error) {
        console.error('加载数据错误:', error);
        res.status(500).json({ error: '数据加载失败' });
    }
});

// ===== 测试 =====
app.get('/api/test', (req, res) => {
    res.json({ message: '后端连接成功！' });
});

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 服务器运行在端口 ${PORT}`);
    console.log(`🔗 健康检查: /health`);
});
