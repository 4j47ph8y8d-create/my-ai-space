const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-me';

// ============================================================
//  🚦 API 频率限制
// ============================================================

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: '请求过于频繁，请 15 分钟后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});

const saveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: '保存操作过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================================
//  🔐 中间件
// ============================================================

app.use(cors({
    origin: ['https://my-ai-space-production.up.railway.app', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ============================================================
//  📦 数据库连接
// ============================================================

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

// ============================================================
//  📊 数据模型
// ============================================================

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

const UserDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    roles: { type: mongoose.Schema.Types.Mixed, default: [] },
    diaries: { type: mongoose.Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now }
});

const UserData = mongoose.model('UserData', UserDataSchema);

// ============================================================
//  🔐 登录失败限制
// ============================================================

const loginAttempts = {};

setInterval(() => {
    const now = Date.now();
    for (const key in loginAttempts) {
        if (now - loginAttempts[key].lastAttempt > 60 * 60 * 1000) {
            delete loginAttempts[key];
        }
    }
}, 60 * 60 * 1000);

// ============================================================
//  🔐 身份验证中间件
// ============================================================

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

// ----- 注册（限流） -----
app.post('/api/auth/register', loginLimiter, async (req, res) => {
    try {
        const { email, password, nickname } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少 6 位' });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: '该邮箱已注册' });
        }
        
        const user = new User({ email, password, nickname });
        await user.save();
        
        const userData = new UserData({ userId: user._id });
        await userData.save();
        
        res.json({
            success: true,
            message: '注册成功！',
            user: { id: user._id, email: user.email, nickname: user.nickname }
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// ----- 登录（限流 + 失败限制） -----
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        
        const key = `login_${email}`;
        if (loginAttempts[key] && loginAttempts[key].count >= 5) {
            const timeLeft = Math.ceil((loginAttempts[key].lockedUntil - Date.now()) / 60000);
            if (timeLeft > 0) {
                return res.status(429).json({ 
                    error: `尝试过多，请 ${timeLeft} 分钟后重试` 
                });
            } else {
                delete loginAttempts[key];
            }
        }
        
        const user = await User.findOne({ email });
        if (!user) {
            if (!loginAttempts[key]) {
                loginAttempts[key] = { count: 0, lastAttempt: Date.now() };
            }
            loginAttempts[key].count++;
            loginAttempts[key].lastAttempt = Date.now();
            if (loginAttempts[key].count >= 5) {
                loginAttempts[key].lockedUntil = Date.now() + 15 * 60 * 1000;
            }
            return res.status(401).json({ error: '账号或密码错误' });
        }
        
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            if (!loginAttempts[key]) {
                loginAttempts[key] = { count: 0, lastAttempt: Date.now() };
            }
            loginAttempts[key].count++;
            loginAttempts[key].lastAttempt = Date.now();
            if (loginAttempts[key].count >= 5) {
                loginAttempts[key].lockedUntil = Date.now() + 15 * 60 * 1000;
            }
            return res.status(401).json({ error: '账号或密码错误' });
        }
        
        delete loginAttempts[key];
        
        const token = jwt.sign(
            { userId: user._id.toString(), email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token: token,
            user: { id: user._id, email: user.email, nickname: user.nickname || email.split('@')[0] }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// ----- 保存数据（限流） -----
app.post('/api/data/save', authenticate, saveLimiter, async (req, res) => {
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

// ----- 加载数据（限流） -----
app.get('/api/data/load', authenticate, globalLimiter, async (req, res) => {
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

// ----- 测试（限流） -----
app.get('/api/test', globalLimiter, (req, res) => {
    res.json({ message: '后端连接成功！' });
});

// ============================================================
//  🚀 启动
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 服务器运行在端口 ${PORT}`);
    console.log(`🔗 健康检查: /health`);
});
