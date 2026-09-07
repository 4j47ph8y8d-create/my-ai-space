const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// ===== JWT 密钥 =====
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-me';

// ===== 中间件 =====
app.use(cors({
    origin: ['https://my-ai-space-production.up.railway.app', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ===== 连接 MongoDB =====
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI 未设置，使用内存存储（仅测试用）');
}

mongoose.connect(MONGODB_URI || 'mongodb://localhost:27017/dream_app', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB 连接成功'))
.catch(err => {
    console.error('❌ MongoDB 连接失败:', err.message);
    console.log('⚠️ 使用内存存储，数据不会持久化');
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

// ============================================================
//  🔐 身份验证中间件（第4步）
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

// ===== 健康检查 =====
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: '服务器运行正常' });
});

// ===== 根路由 =====
app.get('/', (req, res) => {
    res.redirect('/index.html');
});

// ===== 注册接口 =====
app.post('/api/auth/register', async (req, res) => {
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

// ===== 登录接口（使用 JWT） =====
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
        
        // 生成 JWT（7天过期）
        const token = jwt.sign(
            { 
                userId: user._id.toString(),
                email: user.email 
            },
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

// ===== 保存数据接口（安全版） =====
app.post('/api/data/save', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { config, roles, diaries } = req.body;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }
        
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

// ===== 加载数据接口（安全版） =====
app.get('/api/data/load', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }
        
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

// ===== 测试接口 =====
app.get('/api/test', (req, res) => {
    res.json({ message: '后端连接成功！' });
});

// ===== 启动服务 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 服务器运行在端口 ${PORT}`);
    console.log(`🔗 健康检查: /health`);
});

console.log('🚀 服务器启动中...');
