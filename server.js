require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');

const app = express();

// 中间件
app.use(cors({
  origin: '*',  // 允许所有前端域名（开发阶段）
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 健康检查（Railway 需要）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);

// MongoDB 连接
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
  console.log('⚠️ 服务将继续运行，但数据不会持久化');
});

// 启动服务（Railway 用动态端口）
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务运行在端口 ${PORT}`);
  console.log(`📡 健康检查: http://localhost:${PORT}/health`);
});
