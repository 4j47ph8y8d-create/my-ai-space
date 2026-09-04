const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 中间件
app.use(cors());
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

// 密码加密（保存前自动执行）
UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const bcrypt = require('bcryptjs');
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// 验证密码方法
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
        
        // 检查邮箱是否已存在
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: '该邮箱已注册' });
        }
        
        // 创建用户
        const user = new User({ email, password, nickname });
        await user.save();
        
        // 创建空的数据记录
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

// ===== 登录接口 =====
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        
        // 查找用户
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: '账号或密码错误' });
        }
        
        // 验证密码
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: '账号或密码错误' });
        }
        
        // 生成简单 token（真实项目应该用 JWT）
        const token = 'token_' + user._id + '_' + Date.now();
        
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

// ===== 保存数据接口 =====
app.post('/api/data/save', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未认证' });
        }
        
        const token = authHeader.split(' ')[1];
        // 从 token 中提取 userId（简单实现）
        const userIdMatch = token.match(/token_(.+?)_/);
        if (!userIdMatch) {
            return res.status(401).json({ error: '无效的 token' });
        }
        
        const userId = userIdMatch[1];
        
        // 验证用户是否存在
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }
        
        const { config, roles, diaries } = req.body;
        
        let userData = await UserData.findOne({ userId });
        
        if (userData) {
            userData.config = config || userData.config;
            userData.roles = roles || userData.roles;
            userData.diaries = diaries || userData.diaries;
            userData.version += 1;
            userData.updatedAt = new Date();
            await userData.save();
        } else {
            userData = new UserData({ userId, config, roles, diaries });
            await userData.save();
        }
        
        res.json({ success: true, version: userData.version });
    } catch (error) {
        console.error('保存数据错误:', error);
        res.status(500).json({ error: '数据保存失败' });
    }
});

// ===== 加载数据接口 =====
app.get('/api/data/load', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未认证' });
        }
        
        const token = authHeader.split(' ')[1];
        const userIdMatch = token.match(/token_(.+?)_/);
        if (!userIdMatch) {
            return res.status(401).json({ error: '无效的 token' });
        }
        
        const userId = userIdMatch[1];
        
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
