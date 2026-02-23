const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORT = process.env.PORT || 3000;

let pool;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'account_user',
      password: process.env.DB_PASSWORD || 'account_pass',
      database: process.env.DB_NAME || 'account_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 token 无效' });
  }
  try {
    const token = auth.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
  }
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// 注册
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }
  if (username.length < 2 || password.length < 6) {
    return res.status(400).json({ code: 400, message: '用户名至少2位，密码至少6位' });
  }
  try {
    const db = await getPool();
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username.trim(), hash]
    );
    const token = jwt.sign(
      { userId: r.insertId, username: username.trim() },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ code: 0, message: '注册成功', token, userId: r.insertId, username: username.trim() });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ code: 400, message: '用户名已存在' });
    }
    console.error(e);
    res.status(500).json({ code: 500, message: '注册失败' });
  }
});

// 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }
  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT id, username, password_hash FROM users WHERE username = ?', [username.trim()]);
    if (!rows.length) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ code: 0, message: '登录成功', token, userId: user.id, username: user.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ code: 500, message: '登录失败' });
  }
});

// 获取当前用户信息（需登录）
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ code: 0, userId: req.userId, username: req.username });
});

// 获取分类列表（从当前用户历史记录中 distinct）
// 可选参数：type=expense|debt_lend|debt_favor，用于筛选支出/外债分类
app.get('/api/categories', authMiddleware, async (req, res) => {
  const { type } = req.query || {};
  const userId = parseInt(req.userId, 10);
  if (!userId || userId < 1) {
    return res.status(401).json({ code: 401, message: '用户无效，请重新登录' });
  }
  try {
    const db = await getPool();
    let where = 'user_id = ?';
    const params = [userId];
    const validTypes = ['expense', 'debt_lend', 'debt_favor'];
    if (type && validTypes.includes(type)) {
      where += ' AND type = ?';
      params.push(type);
    }
    const [rows] = await db.execute(
      `SELECT DISTINCT category FROM records WHERE ${where} ORDER BY category ASC`,
      params
    );
    const list = (rows || [])
      .map((r) => (r && r.category != null ? String(r.category).trim() : ''))
      .filter(Boolean);
    res.json({ code: 0, list });
  } catch (e) {
    console.error('查询分类失败', e);
    res.status(500).json({ code: 500, message: '查询分类失败' });
  }
});

// 添加记账记录
app.post('/api/records', authMiddleware, async (req, res) => {
  const { type, amount, category, note, record_date } = req.body || {};
  const validTypes = ['expense', 'debt_lend', 'debt_favor'];
  if (!type || !validTypes.includes(type) || amount == null || amount === '') {
    return res.status(400).json({ code: 400, message: '类型为 expense/debt_lend/debt_favor，金额必填' });
  }
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    return res.status(400).json({ code: 400, message: '金额须为正数' });
  }
  const rawDate = record_date || new Date().toISOString().slice(0, 10);
  const date = String(rawDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ code: 400, message: '日期格式须为 YYYY-MM-DD' });
  }
  const userId = parseInt(req.userId, 10);
  if (!userId || userId < 1) {
    return res.status(401).json({ code: 401, message: '用户无效，请重新登录' });
  }
  const categoryStr = ((category || '').trim() || '其他').slice(0, 50);
  const noteStr = (note || '').trim().slice(0, 255);
  try {
    const db = await getPool();
    const [r] = await db.execute(
      'INSERT INTO records (user_id, type, amount, category, note, record_date) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, type, num, categoryStr, noteStr, date]
    );
    res.json({ code: 0, message: '添加成功', id: r.insertId });
  } catch (e) {
    console.error('添加记录失败', e);
    if (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_BAD_FOREIGN_KEY') {
      return res.status(401).json({ code: 401, message: '用户不存在，请重新登录' });
    }
    if (e.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || e.code === 'ER_INVALID_CHARACTER_STRING') {
      return res.status(400).json({ code: 400, message: '分类或备注含有非法字符，请修改后重试' });
    }
    res.status(500).json({ code: 500, message: '添加失败', detail: process.env.NODE_ENV === 'development' ? e.message : undefined });
  }
});

// 获取记账列表（分页、按日期筛选）
app.get('/api/records', authMiddleware, async (req, res) => {
  const { page = 1, pageSize = 20, startDate, endDate, type } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (pageNum - 1) * size;
  try {
    const db = await getPool();
    let where = 'user_id = ?';
    const params = [req.userId];
    if (startDate) {
      where += ' AND record_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      where += ' AND record_date <= ?';
      params.push(endDate);
    }
    const validTypes = ['expense', 'debt_lend', 'debt_favor'];
    if (type && validTypes.includes(type)) {
      where += ' AND type = ?';
      params.push(type);
    }
    // LIMIT/OFFSET 使用数字字面量，避免 mysql2 占位符兼容性问题
    const [rows] = await db.execute(
      `SELECT id, type, amount, category, note, record_date, created_at FROM records WHERE ${where} ORDER BY record_date DESC, id DESC LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total FROM records WHERE ${where}`,
      params
    );
    const total = (countRows && countRows[0] && countRows[0].total) ? Number(countRows[0].total) : 0;
    // 保证返回数组，且日期序列化为字符串便于前端展示
    const list = (rows || []).map((r) => ({
      id: r.id,
      type: r.type,
      amount: r.amount,
      category: r.category,
      note: r.note,
      record_date: r.record_date ? (r.record_date instanceof Date ? r.record_date.toISOString().slice(0, 10) : String(r.record_date).slice(0, 10)) : '',
      created_at: r.created_at,
    }));
    res.json({ code: 0, list, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ code: 500, message: '查询失败' });
  }
});

// 删除记录
app.delete('/api/records/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ code: 400, message: '无效 id' });
  try {
    const db = await getPool();
    const [r] = await db.execute('DELETE FROM records WHERE id = ? AND user_id = ?', [id, req.userId]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在或无权操作' });
    }
    res.json({ code: 0, message: '删除成功' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

// 统计汇总（按日期范围）：支出、借出、人情往来
app.get('/api/summary', authMiddleware, async (req, res) => {
  const { startDate, endDate } = req.query;
  let where = 'user_id = ?';
  const params = [req.userId];
  if (startDate) {
    where += ' AND record_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND record_date <= ?';
    params.push(endDate);
  }
  try {
    const db = await getPool();
    const [rows] = await db.execute(
      `SELECT type, SUM(amount) as total FROM records WHERE ${where} GROUP BY type`,
      params
    );
    const expense = rows.find(r => r.type === 'expense')?.total || 0;
    const debtLend = rows.find(r => r.type === 'debt_lend')?.total || 0;
    const debtFavor = rows.find(r => r.type === 'debt_favor')?.total || 0;
    const debt = Number(debtLend) + Number(debtFavor);
    res.json({
      code: 0,
      expense: Number(expense),
      debt_lend: Number(debtLend),
      debt_favor: Number(debtFavor),
      debt
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ code: 500, message: '统计失败' });
  }
});

async function start() {
  await getPool();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Backend listening on port', PORT);
  });
}

start().catch(err => {
  console.error('Start failed:', err);
  process.exit(1);
});
