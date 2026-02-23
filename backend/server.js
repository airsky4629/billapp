const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// 安全响应头
app.use(helmet({
  contentSecurityPolicy: false, // 允许内联脚本（适配前端）
  crossOriginEmbedderPolicy: false
}));

// CORS 配置（生产环境应限制 origin）
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const PORT = process.env.PORT || 3000;

// 登录失败次数限制配置
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

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

// 密码强度验证
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: '密码不能为空' };
  }
  if (password.length < 8) {
    return { valid: false, message: '密码至少8位' };
  }
  if (password.length > 128) {
    return { valid: false, message: '密码不能超过128位' };
  }
  // 检查是否包含数字
  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个数字' };
  }
  // 检查是否包含字母
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个字母' };
  }
  // 检查常见弱密码
  const commonPasswords = ['12345678', 'password', '123456789', 'qwerty', 'abc123456'];
  if (commonPasswords.includes(password.toLowerCase())) {
    return { valid: false, message: '密码过于简单，请使用更复杂的密码' };
  }
  return { valid: true };
}

// 用户名验证
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: '用户名不能为空' };
  }
  const trimmed = username.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: '用户名至少2位' };
  }
  if (trimmed.length > 50) {
    return { valid: false, message: '用户名不能超过50位' };
  }
  // 只允许字母、数字、下划线、中文
  if (!/^[\w\u4e00-\u9fa5]+$/.test(trimmed)) {
    return { valid: false, message: '用户名只能包含字母、数字、下划线和中文' };
  }
  return { valid: true, username: trimmed };
}

// 生成 Token Hash（用于黑名单）
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// 检查 Token 是否在黑名单中
async function isTokenBlacklisted(tokenHash) {
  try {
    const db = await getPool();
    const [rows] = await db.execute(
      'SELECT id FROM token_blacklist WHERE token_hash = ? AND expires_at > NOW()',
      [tokenHash]
    );
    return rows.length > 0;
  } catch (e) {
    console.error('检查 token 黑名单失败', e);
    return false;
  }
}

// 将 Token 加入黑名单
async function blacklistToken(token, userId) {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) return;
    
    const tokenHash = hashToken(token);
    const expiresAt = new Date(decoded.exp * 1000);
    
    const db = await getPool();
    await db.execute(
      'INSERT INTO token_blacklist (token_hash, user_id, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)',
      [tokenHash, userId, expiresAt]
    );
  } catch (e) {
    console.error('加入 token 黑名单失败', e);
  }
}

// 清理过期的黑名单记录
async function cleanExpiredBlacklist() {
  try {
    const db = await getPool();
    await db.execute('DELETE FROM token_blacklist WHERE expires_at < NOW()');
  } catch (e) {
    console.error('清理过期黑名单失败', e);
  }
}

// 定期清理（每小时一次）
setInterval(cleanExpiredBlacklist, 60 * 60 * 1000);

// 记录登录日志
async function logLoginAttempt(userId, username, ip, userAgent, success, failureReason = null) {
  try {
    const db = await getPool();
    await db.execute(
      'INSERT INTO login_logs (user_id, username, ip_address, user_agent, success, failure_reason) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, username, ip, userAgent, success, failureReason]
  );
  } catch (e) {
    console.error('记录登录日志失败', e);
  }
}

// 获取客户端 IP
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         'unknown';
}

// 检查账户是否被锁定
async function checkAccountLocked(userId) {
  try {
    const db = await getPool();
    const [rows] = await db.execute(
      'SELECT locked_until FROM users WHERE id = ?',
      [userId]
    );
    if (rows.length === 0) return { locked: false };
    
    const lockedUntil = rows[0].locked_until;
    if (!lockedUntil) return { locked: false };
    
    const now = new Date();
    const lockTime = new Date(lockedUntil);
    
    if (lockTime > now) {
      const minutesLeft = Math.ceil((lockTime - now) / 1000 / 60);
      return { locked: true, minutesLeft };
    }
    
    // 锁定已过期，清除锁定状态
    await db.execute(
      'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?',
      [userId]
    );
    return { locked: false };
  } catch (e) {
    console.error('检查账户锁定状态失败', e);
    return { locked: false };
  }
}

// 增加登录失败次数
async function incrementLoginAttempts(userId) {
  try {
    const db = await getPool();
    const [result] = await db.execute(
      'UPDATE users SET login_attempts = login_attempts + 1 WHERE id = ?',
      [userId]
    );
    
    if (result.affectedRows > 0) {
      const [rows] = await db.execute('SELECT login_attempts FROM users WHERE id = ?', [userId]);
      const attempts = rows[0]?.login_attempts || 0;
      
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        // 锁定账户
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
        await db.execute(
          'UPDATE users SET locked_until = ? WHERE id = ?',
          [lockUntil, userId]
        );
      }
    }
  } catch (e) {
    console.error('更新登录失败次数失败', e);
  }
}

// 重置登录失败次数
async function resetLoginAttempts(userId) {
  try {
    const db = await getPool();
    await db.execute(
      'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
      [userId]
    );
  } catch (e) {
    console.error('重置登录失败次数失败', e);
  }
}

// 更新最后登录信息
async function updateLastLogin(userId, ip) {
  try {
    const db = await getPool();
    await db.execute(
      'UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?',
      [ip, userId]
    );
  } catch (e) {
    console.error('更新最后登录信息失败', e);
  }
}

// 认证中间件
async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 token 无效' });
  }
  try {
    const token = auth.slice(7);
    const tokenHash = hashToken(token);
    
    // 检查是否在黑名单中
    const isBlacklisted = await isTokenBlacklisted(tokenHash);
    if (isBlacklisted) {
      return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
  }
}

// 请求频率限制
const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 5, // 最多 5 次请求
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 100, // 最多 100 次请求
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// 注册
app.post('/api/register', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // 验证用户名
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    await logLoginAttempt(null, username || 'unknown', ip, userAgent, false, usernameValidation.message);
    return res.status(400).json({ code: 400, message: usernameValidation.message });
  }
  
  // 验证密码
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    await logLoginAttempt(null, usernameValidation.username, ip, userAgent, false, passwordValidation.message);
    return res.status(400).json({ code: 400, message: passwordValidation.message });
  }
  
  try {
    const db = await getPool();
    const hash = await bcrypt.hash(password, 12); // 增加 bcrypt 轮数到 12
    
    const [r] = await db.execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [usernameValidation.username, hash]
    );
    
    const userId = r.insertId;
    
    // 生成 access token 和 refresh token
    const accessToken = jwt.sign(
      { userId, username: usernameValidation.username, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' } // Access token 1 小时
    );
    
    const refreshToken = jwt.sign(
      { userId, username: usernameValidation.username, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' } // Refresh token 7 天
    );
    
    await logLoginAttempt(userId, usernameValidation.username, ip, userAgent, true);
    await updateLastLogin(userId, ip);
    
    res.json({
      code: 0,
      message: '注册成功',
      token: accessToken,
      refreshToken: refreshToken,
      userId: userId,
      username: usernameValidation.username
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      await logLoginAttempt(null, usernameValidation.username, ip, userAgent, false, '用户名已存在');
      return res.status(400).json({ code: 400, message: '用户名已存在' });
    }
    console.error('注册失败', e);
    await logLoginAttempt(null, usernameValidation.username, ip, userAgent, false, '服务器错误');
    res.status(500).json({ code: 500, message: '注册失败' });
  }
});

// 登录
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  if (!username || !password) {
    await logLoginAttempt(null, username || 'unknown', ip, userAgent, false, '用户名和密码不能为空');
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }
  
  try {
    const db = await getPool();
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      await logLoginAttempt(null, username, ip, userAgent, false, '用户名格式无效');
      return res.status(400).json({ code: 400, message: usernameValidation.message });
    }
    
    const [rows] = await db.execute(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [usernameValidation.username]
    );
    
    if (!rows.length) {
      await logLoginAttempt(null, usernameValidation.username, ip, userAgent, false, '用户名不存在');
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    
    const user = rows[0];
    
    // 检查账户是否被锁定
    const lockStatus = await checkAccountLocked(user.id);
    if (lockStatus.locked) {
      await logLoginAttempt(user.id, user.username, ip, userAgent, false, `账户已锁定，${lockStatus.minutesLeft}分钟后可重试`);
      return res.status(423).json({
        code: 423,
        message: `账户已被锁定，请${lockStatus.minutesLeft}分钟后再试`
      });
    }
    
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await incrementLoginAttempts(user.id);
      await logLoginAttempt(user.id, user.username, ip, userAgent, false, '密码错误');
      
      // 再次检查是否因失败次数过多而被锁定
      const newLockStatus = await checkAccountLocked(user.id);
      if (newLockStatus.locked) {
        return res.status(423).json({
          code: 423,
          message: `密码错误次数过多，账户已被锁定${LOCKOUT_DURATION_MINUTES}分钟`
        });
      }
      
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    
    // 登录成功
    await resetLoginAttempts(user.id);
    await updateLastLogin(user.id, ip);
    
    // 生成 access token 和 refresh token
    const accessToken = jwt.sign(
      { userId: user.id, username: user.username, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    const refreshToken = jwt.sign(
      { userId: user.id, username: user.username, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    await logLoginAttempt(user.id, user.username, ip, userAgent, true);
    
    res.json({
      code: 0,
      message: '登录成功',
      token: accessToken,
      refreshToken: refreshToken,
      userId: user.id,
      username: user.username
    });
  } catch (e) {
    console.error('登录失败', e);
    await logLoginAttempt(null, username, ip, userAgent, false, '服务器错误');
    res.status(500).json({ code: 500, message: '登录失败' });
  }
});

// 刷新 Token
app.post('/api/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  
  if (!refreshToken) {
    return res.status(400).json({ code: 400, message: 'refreshToken 不能为空' });
  }
  
  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ code: 401, message: '无效的 refresh token' });
    }
    
    // 检查用户是否存在
    const db = await getPool();
    const [rows] = await db.execute('SELECT id, username FROM users WHERE id = ?', [decoded.userId]);
    if (!rows.length) {
      return res.status(401).json({ code: 401, message: '用户不存在' });
    }
    
    const user = rows[0];
    
    // 生成新的 access token
    const accessToken = jwt.sign(
      { userId: user.id, username: user.username, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({
      code: 0,
      token: accessToken,
      userId: user.id,
      username: user.username
    });
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, message: 'refreshToken 已过期，请重新登录' });
    }
    return res.status(401).json({ code: 401, message: '无效的 refreshToken' });
  }
});

// 退出登录
app.post('/api/logout', authMiddleware, async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      await blacklistToken(token, req.userId);
    }
    res.json({ code: 0, message: '退出成功' });
  } catch (e) {
    console.error('退出登录失败', e);
    res.json({ code: 0, message: '退出成功' }); // 即使失败也返回成功
  }
});

// 应用 API 频率限制（在受保护接口之前）
app.use('/api', apiLimiter);

// 获取当前用户信息（需登录）
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ code: 0, userId: req.userId, username: req.username });
});

// 获取分类列表（从当前用户历史记录中 distinct）
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
    const [rows] = await db.execute(
      `SELECT id, type, amount, category, note, record_date, created_at FROM records WHERE ${where} ORDER BY record_date DESC, id DESC LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total FROM records WHERE ${where}`,
      params
    );
    const total = (countRows && countRows[0] && countRows[0].total) ? Number(countRows[0].total) : 0;
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
