const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== 健康检查 =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '服务器运行正常' });
});

// ===== 注册接口 =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;
    console.log('注册请求:', email);
    res.json({ 
      success: true, 
      message: '注册成功！',
      user: { email, nickname: nickname || email.split('@')[0] }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 登录接口 =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('登录请求:', email);
    res.json({ 
      success: true, 
      token: 'test-token-' + Date.now(),
      user: { email, nickname: email.split('@')[0] }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 保存数据接口 =====
app.post('/api/data/save', async (req, res) => {
  try {
    console.log('保存数据请求');
    res.json({ success: true, version: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 加载数据接口 =====
app.get('/api/data/load', async (req, res) => {
  try {
    console.log('加载数据请求');
    res.json({ 
      success: true, 
      data: null, 
      version: 0 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 测试接口
app.get('/api/test', (req, res) => {
  res.json({ message: '后端连接成功！' });
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器运行在端口 ${PORT}`);
  console.log(`🔗 健康检查: /health`);
});

console.log('🚀 服务器启动中...');
