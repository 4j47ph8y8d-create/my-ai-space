const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 数据存储（内存中，重启会丢失）
const users = {};

// 注册
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ success: false, message: '密码至少 6 位' });
  if (users[email]) return res.status(400).json({ success: false, message: '该邮箱已注册' });
  users[email] = { password, data: { config: {}, roles: [], currentRoleId: null, diaries: [] } };
  res.json({ success: true, message: '注册成功' });
});

// 登录
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
  const user = users[email];
  if (!user) return res.status(400).json({ success: false, message: '账号不存在' });
  if (user.password !== password) return res.status(400).json({ success: false, message: '密码错误' });
  res.json({ success: true, message: '登录成功', email });
});

// 保存数据
app.post('/api/save', (req, res) => {
  const { email, data } = req.body;
  if (!email || !data) return res.status(400).json({ success: false, message: '缺少参数' });
  if (!users[email]) return res.status(400).json({ success: false, message: '用户不存在' });
  users[email].data = data;
  res.json({ success: true, message: '数据已保存' });
});

// 加载数据
app.post('/api/load', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: '缺少邮箱' });
  if (!users[email]) return res.status(400).json({ success: false, message: '用户不存在' });
  res.json({ success: true, data: users[email].data });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🌙 LunarReverie 后端已启动');
  console.log('📍 地址: http://localhost:' + PORT);
});
