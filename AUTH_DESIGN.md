# 登录态设计文档

## 1. 概述

本项目采用 **JWT (JSON Web Token)** 作为认证机制，实现无状态的用户登录态管理。系统采用 **Access Token + Refresh Token** 双 Token 机制，提供更安全的认证体验。

### 1.1 设计原则

- **双 Token 机制**：Access Token（1小时）+ Refresh Token（7天）
- **无状态认证**：使用 JWT，服务端不存储会话信息（除黑名单外）
- **自动刷新**：Access Token 过期时自动使用 Refresh Token 刷新
- **前端存储**：Token 存储在浏览器 `localStorage` 中
- **自动校验**：页面刷新时自动校验 Token 有效性
- **数据隔离**：所有业务数据按 `user_id` 进行隔离（详见 [PERMISSION_DESIGN.md](./PERMISSION_DESIGN.md)）
- **安全加固**：登录失败限制、账户锁定、请求频率限制、安全响应头

### 1.2 安全特性

- ✅ **登录失败次数限制**：5次失败后锁定账户15分钟
- ✅ **Token 刷新机制**：自动刷新过期的 Access Token
- ✅ **Token 黑名单**：退出登录时使 Token 失效
- ✅ **密码强度验证**：至少8位，包含数字和字母
- ✅ **请求频率限制**：防止 API 滥用和暴力破解
- ✅ **安全响应头**：使用 Helmet 添加安全头
- ✅ **登录日志记录**：记录所有登录尝试
- ✅ **账户锁定机制**：防止暴力破解攻击

## 2. Token 机制

### 2.1 双 Token 架构

**Access Token**：
- 有效期：1 小时
- 用途：日常 API 请求认证
- 存储：前端 localStorage
- 过期后：自动使用 Refresh Token 刷新

**Refresh Token**：
- 有效期：7 天
- 用途：刷新 Access Token
- 存储：前端 localStorage
- 过期后：需要重新登录

### 2.2 Token 生成

**后端实现**（`backend/server.js`）：

```javascript
// Access Token
const accessToken = jwt.sign(
  { userId: user.id, username: user.username, type: 'access' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

// Refresh Token
const refreshToken = jwt.sign(
  { userId: user.id, username: user.username, type: 'refresh' },
  JWT_REFRESH_SECRET,
  { expiresIn: '7d' }
);
```

**Token 内容**：
- `userId`：用户 ID（数据库主键）
- `username`：用户名
- `type`：Token 类型（'access' 或 'refresh'）
- `exp`：过期时间

**密钥配置**：
- `JWT_SECRET`：Access Token 签名密钥
- `JWT_REFRESH_SECRET`：Refresh Token 签名密钥
- 生产环境必须使用强随机密钥

### 2.3 Token 刷新流程

```
API 请求返回 401（Token 过期）
    ↓
前端检测到 401 错误
    ↓
调用 /api/refresh 接口
    ↓
使用 Refresh Token 获取新的 Access Token
    ↓
使用新 Token 重试原始请求
    ↓
请求成功
```

**前端实现**（`frontend/dist/app.js`）：

```javascript
async function refreshAccessToken() {
  const res = await fetch('/api/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  const data = await res.json();
  if (res.ok && data.code === 0) {
    token = data.token;
    localStorage.setItem('token', token);
    return token;
  }
  // 刷新失败，清除所有 token
  throw new Error('刷新 token 失败');
}
```

### 2.4 Token 黑名单

**实现目的**：
- 退出登录时使 Token 立即失效
- 防止已退出的 Token 被继续使用

**实现方式**：
- Token Hash 存储在数据库 `token_blacklist` 表
- 每次验证 Token 时检查黑名单
- 定期清理过期的黑名单记录

**数据库表结构**：
```sql
CREATE TABLE token_blacklist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires (expires_at)
);
```

## 3. 认证流程

### 3.1 注册流程

```
用户填写注册表单
    ↓
前端验证用户名和密码格式
    ↓
前端发送 POST /api/register
    ↓
后端验证用户名格式（2-50位，字母数字下划线中文）
    ↓
后端验证密码强度（至少8位，包含数字和字母）
    ↓
密码使用 bcrypt 加密存储（轮数：12）
    ↓
生成 Access Token 和 Refresh Token
    ↓
返回 Token 和用户信息
    ↓
前端保存 Token 到 localStorage
    ↓
跳转到主页面
```

**关键代码位置**：
- 后端：`backend/server.js` 第 280-350 行
- 前端：`frontend/dist/app.js` 第 737-753 行

### 3.2 登录流程

```
用户填写登录表单
    ↓
前端发送 POST /api/login
    ↓
后端检查请求频率限制（15分钟5次）
    ↓
后端查询用户信息
    ↓
检查账户是否被锁定
    ↓
使用 bcrypt 验证密码
    ↓
密码错误：增加失败次数，检查是否锁定
    ↓
密码正确：重置失败次数，更新最后登录信息
    ↓
生成 Access Token 和 Refresh Token
    ↓
记录登录日志
    ↓
返回 Token 和用户信息
    ↓
前端保存 Token 到 localStorage
    ↓
跳转到主页面
```

**关键代码位置**：
- 后端：`backend/server.js` 第 353-430 行
- 前端：`frontend/dist/app.js` 第 718-734 行

### 3.3 请求认证流程

```
前端发起 API 请求
    ↓
从 localStorage 读取 Access Token
    ↓
在请求头中添加 Authorization: Bearer <token>
    ↓
后端 authMiddleware 拦截请求
    ↓
检查 Token 是否在黑名单中
    ↓
验证 Token 有效性（签名、过期时间）
    ↓
解析 Token 获取 userId 和 username
    ↓
将用户信息附加到 req 对象
    ↓
继续处理业务逻辑
    ↓
如果返回 401：前端自动刷新 Token 并重试
```

**关键代码位置**：
- 后端：`backend/server.js` 第 245-265 行（authMiddleware）
- 前端：`frontend/dist/app.js` 第 108-150 行（api 函数）

### 3.4 Token 刷新流程

```
前端检测到 401 错误
    ↓
检查是否有 Refresh Token
    ↓
调用 POST /api/refresh
    ↓
后端验证 Refresh Token
    ↓
检查用户是否存在
    ↓
生成新的 Access Token
    ↓
返回新 Token
    ↓
前端更新 Access Token
    ↓
使用新 Token 重试原始请求
```

**关键代码位置**：
- 后端：`backend/server.js` 第 433-470 行
- 前端：`frontend/dist/app.js` 第 115-135 行

### 3.5 退出登录流程

```
用户点击退出按钮
    ↓
前端调用 POST /api/logout
    ↓
后端将当前 Token 加入黑名单
    ↓
前端清除所有 Token 和用户信息
    ↓
跳转到登录页面
```

**关键代码位置**：
- 后端：`backend/server.js` 第 473-485 行
- 前端：`frontend/dist/app.js` 第 755-762 行

## 4. 安全机制

### 4.1 登录失败次数限制

**配置**：
- 最大失败次数：5 次
- 锁定时长：15 分钟

**实现逻辑**：
1. 每次登录失败，`login_attempts` 字段 +1
2. 达到 5 次后，设置 `locked_until` 为当前时间 + 15 分钟
3. 登录时检查 `locked_until`，如果未过期则拒绝登录
4. 登录成功后，重置 `login_attempts` 和 `locked_until`

**数据库字段**：
```sql
login_attempts INT DEFAULT 0,
locked_until TIMESTAMP NULL,
```

**错误响应**：
```json
{
  "code": 423,
  "message": "账户已被锁定，请15分钟后再试"
}
```

### 4.2 密码强度验证

**规则**：
- 长度：8-128 位
- 必须包含：至少一个数字
- 必须包含：至少一个字母
- 禁止：常见弱密码（12345678, password 等）

**验证函数**（`backend/server.js` 第 50-75 行）：

```javascript
function validatePasswordStrength(password) {
  if (password.length < 8) {
    return { valid: false, message: '密码至少8位' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个数字' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个字母' };
  }
  // 检查常见弱密码...
  return { valid: true };
}
```

### 4.3 用户名验证

**规则**：
- 长度：2-50 位
- 允许字符：字母、数字、下划线、中文
- 自动去除首尾空格

**验证函数**（`backend/server.js` 第 77-95 行）：

```javascript
function validateUsername(username) {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 50) {
    return { valid: false, message: '用户名长度无效' };
  }
  if (!/^[\w\u4e00-\u9fa5]+$/.test(trimmed)) {
    return { valid: false, message: '用户名只能包含字母、数字、下划线和中文' };
  }
  return { valid: true, username: trimmed };
}
```

### 4.4 请求频率限制

**登录接口限制**：
- 时间窗口：1 分钟
- 最大请求数：5 次
- 超出限制返回：429 状态码

**API 接口限制**：
- 时间窗口：1 分钟
- 最大请求数：100 次
- 超出限制返回：429 状态码

**实现**（使用 `express-rate-limit`）：

```javascript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { code: 429, message: '请求过于频繁，请稍后再试' }
});
```

### 4.5 安全响应头

**使用 Helmet 中间件**：
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security`（HTTPS 时）
- 其他安全头

**配置**（`backend/server.js` 第 12-16 行）：

```javascript
app.use(helmet({
  contentSecurityPolicy: false, // 允许内联脚本
  crossOriginEmbedderPolicy: false
}));
```

### 4.6 CORS 配置

**当前配置**：
- 允许所有来源（开发环境）
- 支持凭证（credentials）

**生产环境建议**：
```javascript
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'https://yourdomain.com',
  credentials: true
};
```

### 4.7 密码加密

**加密方式**：
- 算法：bcrypt
- 轮数：12（比之前的 10 更安全）
- 存储：只存储哈希值，不存储明文

**实现**：
```javascript
const hash = await bcrypt.hash(password, 12);
const ok = await bcrypt.compare(password, user.password_hash);
```

### 4.8 登录日志

**记录内容**：
- 用户 ID（如果存在）
- 用户名
- IP 地址
- User-Agent
- 登录结果（成功/失败）
- 失败原因

**数据库表**：
```sql
CREATE TABLE login_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  username VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  success BOOLEAN DEFAULT FALSE,
  failure_reason VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**用途**：
- 安全审计
- 异常登录检测
- 攻击分析

## 5. Token 管理

### 5.1 Token 存储

**前端实现**（`frontend/dist/app.js`）：

```javascript
// 保存 Token
localStorage.setItem('token', accessToken);
localStorage.setItem('refreshToken', refreshToken);
localStorage.setItem('username', currentUsername);

// 读取 Token
let token = localStorage.getItem('token');
let refreshToken = localStorage.getItem('refreshToken');
let currentUsername = localStorage.getItem('username') || '';
```

**存储位置**：
- `localStorage.token`：Access Token
- `localStorage.refreshToken`：Refresh Token
- `localStorage.username`：用户名（用于显示）

### 5.2 Token 验证

**后端中间件**（`backend/server.js` 第 245-265 行）：

```javascript
async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 token 无效' });
  }
  
  const token = auth.slice(7);
  const tokenHash = hashToken(token);
  
  // 检查是否在黑名单中
  const isBlacklisted = await isTokenBlacklisted(tokenHash);
  if (isBlacklisted) {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
  }
  
  // 验证 Token
  const decoded = jwt.verify(token, JWT_SECRET);
  req.userId = decoded.userId;
  req.username = decoded.username;
  next();
}
```

**验证步骤**：
1. 检查请求头格式
2. 计算 Token Hash
3. 检查黑名单
4. 验证 Token 签名和过期时间
5. 提取用户信息

### 5.3 Token 刷新

**自动刷新机制**：
- 前端 API 函数自动检测 401 错误
- 自动调用刷新接口获取新 Token
- 使用新 Token 重试原始请求
- 用户无感知

**手动刷新**：
```javascript
POST /api/refresh
Body: { "refreshToken": "..." }
Response: { "code": 0, "token": "新的 access token" }
```

## 6. 前端实现细节

### 6.1 API 请求封装

**实现位置**：`frontend/dist/app.js` 第 108-150 行

**特点**：
- 自动添加 Token 到请求头
- 自动处理 401 错误并刷新 Token
- 统一错误处理
- 支持 JSON 和文本响应

### 6.2 页面初始化校验

**实现位置**：`frontend/dist/app.js` 第 981-987 行

**逻辑**：
1. 页面加载时检查 localStorage 中是否存在 Token
2. 如果存在，调用 `/api/me` 验证 Token 有效性
3. 验证成功：显示主页面
4. 验证失败：清除 Token，显示登录页

### 6.3 退出登录

**实现位置**：`frontend/dist/app.js` 第 755-762 行

**操作**：
1. 调用 `/api/logout` 使 Token 失效
2. 清除内存中的 Token
3. 清除 localStorage 中的 Token
4. 切换到登录页面

## 7. 后端实现细节

### 7.1 认证中间件

**实现位置**：`backend/server.js` 第 245-265 行

**功能**：
- 拦截需要认证的请求
- 检查 Token 黑名单
- 验证 Token 有效性
- 提取用户信息并附加到请求对象

### 7.2 受保护的接口

**需要认证的接口**：
- `GET /api/me`：获取当前用户信息
- `GET /api/categories`：获取分类列表
- `POST /api/records`：添加记账记录
- `GET /api/records`：获取记账列表
- `DELETE /api/records/:id`：删除记录
- `GET /api/summary`：获取统计汇总
- `POST /api/logout`：退出登录

**无需认证的接口**：
- `GET /api/health`：健康检查
- `POST /api/register`：注册
- `POST /api/login`：登录
- `POST /api/refresh`：刷新 Token

### 7.3 用户数据隔离

**实现方式**：
所有业务接口在查询和操作数据时，都会使用 `req.userId` 进行过滤：

```javascript
let where = 'user_id = ?';
const params = [req.userId];
```

**安全保证**：
- 用户只能访问和操作自己的数据
- 即使知道其他用户的记录 ID，也无法访问
- 数据库层面通过 `user_id` 字段实现隔离

## 8. 错误处理

### 8.1 认证错误

**错误码**：401

**常见错误**：
- `未登录或 token 无效`：请求头中缺少或格式错误的 Token
- `登录已过期，请重新登录`：Token 过期或签名无效
- `无效的 refreshToken`：Refresh Token 无效或过期

**处理方式**：
- 前端收到 401 错误时自动尝试刷新 Token
- 刷新失败时清除 Token 并跳转登录页

### 8.2 账户锁定错误

**错误码**：423

**错误信息**：
- `账户已被锁定，请15分钟后再试`
- `密码错误次数过多，账户已被锁定15分钟`

**处理方式**：
- 前端显示锁定提示
- 用户需要等待锁定时间结束

### 8.3 频率限制错误

**错误码**：429

**错误信息**：
- `请求过于频繁，请稍后再试`

**处理方式**：
- 前端显示提示信息
- 用户需要等待一段时间后重试

### 8.4 业务错误

**错误码**：400、404、500

**常见错误**：
- `用户名和密码不能为空`：注册/登录时参数缺失
- `密码至少8位`：密码不符合强度要求
- `用户名已存在`：注册时用户名重复
- `用户名或密码错误`：登录时认证失败
- `记录不存在或无权操作`：删除记录时权限检查失败

## 9. 配置说明

### 9.1 环境变量

**后端配置**（`backend/server.js`）：

```javascript
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
```

**数据库配置**：
```javascript
host: process.env.DB_HOST || 'localhost',
port: process.env.DB_PORT || 3306,
user: process.env.DB_USER || 'account_user',
password: process.env.DB_PASSWORD || 'account_pass',
database: process.env.DB_NAME || 'account_db',
```

### 9.2 Docker Compose 配置

**环境变量设置**（`docker-compose.yml`）：
```yaml
environment:
  JWT_SECRET: your-jwt-secret-change-in-production
  JWT_REFRESH_SECRET: your-jwt-refresh-secret-change-in-production
  CORS_ORIGIN: "*"
  DB_HOST: mysql
  DB_USER: account_user
  DB_PASSWORD: account_pass
  DB_NAME: account_db
```

**生产环境建议**：
- 使用强随机密钥作为 `JWT_SECRET` 和 `JWT_REFRESH_SECRET`
- 使用 `.env` 文件管理敏感配置
- 限制 `CORS_ORIGIN` 为实际的前端域名
- 启用 HTTPS
- 定期轮换密钥

### 9.3 安全配置参数

**登录失败限制**：
```javascript
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
```

**Token 有效期**：
```javascript
// Access Token
{ expiresIn: '1h' }

// Refresh Token
{ expiresIn: '7d' }
```

**密码加密轮数**：
```javascript
const hash = await bcrypt.hash(password, 12);
```

## 10. 数据库设计

### 10.1 用户表（users）

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) DEFAULT '',
  login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP NULL,
  last_login_at TIMESTAMP NULL,
  last_login_ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_locked (locked_until)
);
```

**新增字段说明**：
- `login_attempts`：登录失败次数
- `locked_until`：账户锁定到期时间
- `last_login_at`：最后登录时间
- `last_login_ip`：最后登录 IP

### 10.2 Token 黑名单表（token_blacklist）

```sql
CREATE TABLE token_blacklist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 10.3 登录日志表（login_logs）

```sql
CREATE TABLE login_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  username VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  success BOOLEAN DEFAULT FALSE,
  failure_reason VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_username (username),
  INDEX idx_created (created_at)
);
```

## 11. 最佳实践

### 11.1 前端建议

1. **Token 存储**：
   - 使用 `localStorage` 存储 Token（当前实现）
   - 注意 XSS 攻击风险
   - 考虑使用 `httpOnly` Cookie（需要后端配合）

2. **自动刷新**：
   - 已实现自动刷新机制
   - Token 过期时自动刷新，用户无感知

3. **错误处理**：
   - 统一处理 401 错误
   - 自动跳转登录页
   - 显示友好的错误提示

### 11.2 后端建议

1. **Token 管理**：
   - 使用强随机密钥
   - 定期轮换密钥
   - 使用 Token 黑名单机制

2. **安全加固**：
   - 启用 HTTPS
   - 实现请求频率限制
   - 记录登录日志
   - 监控异常登录行为

3. **性能优化**：
   - Token 验证使用缓存（Redis，可选）
   - 数据库查询优化
   - 连接池管理

## 12. 安全改进总结

### 12.1 已实现的安全功能

✅ **登录失败次数限制**
- 5次失败后锁定账户15分钟
- 防止暴力破解攻击

✅ **Token 刷新机制**
- Access Token 1小时，Refresh Token 7天
- 自动刷新，用户无感知

✅ **Token 黑名单**
- 退出登录时使 Token 立即失效
- 防止已退出的 Token 被继续使用

✅ **密码强度验证**
- 至少8位，包含数字和字母
- 禁止常见弱密码

✅ **请求频率限制**
- 登录接口：1分钟5次
- API 接口：1分钟100次

✅ **安全响应头**
- 使用 Helmet 添加安全头
- 防止 XSS、点击劫持等攻击

✅ **登录日志记录**
- 记录所有登录尝试
- 包含 IP、User-Agent、失败原因等

✅ **账户锁定机制**
- 自动锁定和解锁
- 显示剩余锁定时间

### 12.2 安全等级提升

**之前**：
- 基础 JWT 认证
- 简单密码验证
- 无频率限制
- 无账户锁定

**现在**：
- 双 Token 机制
- 强密码验证
- 请求频率限制
- 账户锁定机制
- Token 黑名单
- 登录日志记录
- 安全响应头

## 13. 未来优化方向

### 13.1 短期优化

1. **Redis 缓存**：
   - Token 黑名单使用 Redis
   - 登录失败次数使用 Redis
   - 提高性能

2. **记住我功能**：
   - 延长 Refresh Token 有效期
   - 提供"记住我"选项

3. **登录通知**：
   - 异常登录邮件通知
   - 新设备登录提醒

### 13.2 长期优化

1. **多因素认证（MFA）**：
   - 短信验证码
   - 邮箱验证
   - 双因素认证

2. **OAuth 集成**：
   - 支持第三方登录（微信、QQ、GitHub 等）
   - 统一认证中心

3. **设备管理**：
   - 查看已登录设备
   - 强制退出设备
   - 设备信任机制

4. **安全监控**：
   - 异常登录检测
   - 攻击模式识别
   - 自动防护机制

## 14. 相关文档与文件

- **[PERMISSION_DESIGN.md](./PERMISSION_DESIGN.md)**：权限设计（接口权限矩阵、数据级授权、与认证的衔接）

**代码与数据文件**：

- **后端认证中间件**：`backend/server.js` 第 245-265 行
- **注册接口**：`backend/server.js` 第 280-350 行
- **登录接口**：`backend/server.js` 第 353-430 行
- **Token 刷新接口**：`backend/server.js` 第 433-470 行
- **退出登录接口**：`backend/server.js` 第 473-485 行
- **前端 API 封装**：`frontend/dist/app.js` 第 108-150 行
- **前端登录处理**：`frontend/dist/app.js` 第 718-734 行
- **前端注册处理**：`frontend/dist/app.js` 第 737-753 行
- **前端退出处理**：`frontend/dist/app.js` 第 755-762 行
- **前端初始化校验**：`frontend/dist/app.js` 第 981-987 行
- **数据库用户表**：`mysql/init/01-schema.sql`
- **Token 黑名单表**：`mysql/init/01-schema.sql`
- **登录日志表**：`mysql/init/01-schema.sql`

---

**文档版本**：v2.0  
**最后更新**：2026-02-23  
**维护者**：项目开发团队
