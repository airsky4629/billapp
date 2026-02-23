# 登录态设计文档

## 1. 概述

本项目采用 **JWT (JSON Web Token)** 作为认证机制，实现无状态的用户登录态管理。用户通过注册或登录获取 JWT Token，后续请求在 HTTP 请求头中携带 Token 进行身份验证。

### 1.1 设计原则

- **无状态认证**：使用 JWT，服务端不存储会话信息
- **Token 有效期**：Token 有效期为 7 天
- **前端存储**：Token 存储在浏览器 `localStorage` 中
- **自动校验**：页面刷新时自动校验 Token 有效性
- **数据隔离**：所有业务数据按 `user_id` 进行隔离

## 2. 认证流程

### 2.1 注册流程

```
用户填写注册表单
    ↓
前端发送 POST /api/register
    ↓
后端验证用户名和密码
    ↓
密码使用 bcrypt 加密存储
    ↓
生成 JWT Token（包含 userId 和 username）
    ↓
返回 Token 和用户信息
    ↓
前端保存 Token 到 localStorage
    ↓
跳转到主页面
```

**关键代码位置**：
- 后端：`backend/server.js` 第 54-82 行
- 前端：`frontend/dist/app.js` 第 737-753 行

### 2.2 登录流程

```
用户填写登录表单
    ↓
前端发送 POST /api/login
    ↓
后端查询用户信息
    ↓
使用 bcrypt 验证密码
    ↓
生成 JWT Token（包含 userId 和 username）
    ↓
返回 Token 和用户信息
    ↓
前端保存 Token 到 localStorage
    ↓
跳转到主页面
```

**关键代码位置**：
- 后端：`backend/server.js` 第 85-111 行
- 前端：`frontend/dist/app.js` 第 718-734 行

### 2.3 请求认证流程

```
前端发起 API 请求
    ↓
从 localStorage 读取 Token
    ↓
在请求头中添加 Authorization: Bearer <token>
    ↓
后端 authMiddleware 拦截请求
    ↓
验证 Token 有效性
    ↓
解析 Token 获取 userId 和 username
    ↓
将用户信息附加到 req 对象
    ↓
继续处理业务逻辑
```

**关键代码位置**：
- 后端：`backend/server.js` 第 32-46 行（authMiddleware）
- 前端：`frontend/dist/app.js` 第 108-123 行（api 函数）

## 3. Token 管理

### 3.1 Token 生成

**后端实现**（`backend/server.js`）：

```javascript
const token = jwt.sign(
  { userId: user.id, username: user.username },
  JWT_SECRET,
  { expiresIn: '7d' }
);
```

**Token 内容**：
- `userId`：用户 ID（数据库主键）
- `username`：用户名
- `exp`：过期时间（7 天后）

**密钥配置**：
- 通过环境变量 `JWT_SECRET` 配置
- 默认值：`'dev-secret'`（开发环境）
- 生产环境必须修改为强密钥

### 3.2 Token 存储

**前端实现**（`frontend/dist/app.js`）：

```javascript
// 保存 Token
localStorage.setItem('token', token);
localStorage.setItem('username', currentUsername);

// 读取 Token
let token = localStorage.getItem('token');
let currentUsername = localStorage.getItem('username') || '';
```

**存储位置**：
- `localStorage.token`：JWT Token
- `localStorage.username`：用户名（用于显示，非认证依据）

### 3.3 Token 验证

**后端中间件**（`backend/server.js` 第 32-46 行）：

```javascript
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
```

**验证逻辑**：
1. 检查请求头中是否存在 `Authorization` 字段
2. 检查格式是否为 `Bearer <token>`
3. 使用 `jwt.verify()` 验证 Token 签名和过期时间
4. 解析成功后，将 `userId` 和 `username` 附加到 `req` 对象
5. 验证失败返回 401 错误

### 3.4 Token 刷新

**当前实现**：
- 本项目**未实现** Token 刷新机制
- Token 过期后需要用户重新登录
- Token 有效期为 7 天

**未来优化建议**：
- 实现 Refresh Token 机制
- 在 Token 即将过期时自动刷新
- 提供 `/api/refresh` 接口

## 4. 前端实现细节

### 4.1 API 请求封装

**实现位置**：`frontend/dist/app.js` 第 108-123 行

```javascript
function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch((API_BASE || '') + url, { ...options, headers })
    .then((res) => {
      // 处理响应...
    });
}
```

**特点**：
- 自动在请求头中添加 Token
- 统一处理错误响应
- 支持 JSON 和文本响应

### 4.2 页面初始化校验

**实现位置**：`frontend/dist/app.js` 第 981-987 行

```javascript
if (token) {
  api('/api/me')
    .then(() => { 
      showPage(true); 
      initMainPage(); 
    })
    .catch(() => { 
      token = ''; 
      localStorage.removeItem('token'); 
      showPage(false); 
    });
} else {
  showPage(false);
}
```

**逻辑**：
1. 页面加载时检查 localStorage 中是否存在 Token
2. 如果存在，调用 `/api/me` 验证 Token 有效性
3. 验证成功：显示主页面
4. 验证失败：清除 Token，显示登录页

### 4.3 退出登录

**实现位置**：`frontend/dist/app.js` 第 755-762 行

```javascript
$('logout-btn').addEventListener('click', () => {
  token = '';
  currentUsername = '';
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  showPage(false);
  setAuthMessage('');
});
```

**操作**：
- 清除内存中的 Token 和用户名
- 清除 localStorage 中的 Token 和用户名
- 切换到登录页面

## 5. 后端实现细节

### 5.1 认证中间件

**实现位置**：`backend/server.js` 第 32-46 行

**功能**：
- 拦截需要认证的请求
- 验证 Token 有效性
- 提取用户信息并附加到请求对象

**使用方式**：
```javascript
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ code: 0, userId: req.userId, username: req.username });
});
```

### 5.2 受保护的接口

**需要认证的接口**：
- `GET /api/me`：获取当前用户信息
- `GET /api/categories`：获取分类列表
- `POST /api/records`：添加记账记录
- `GET /api/records`：获取记账列表
- `DELETE /api/records/:id`：删除记录
- `GET /api/summary`：获取统计汇总

**无需认证的接口**：
- `GET /api/health`：健康检查
- `POST /api/register`：注册
- `POST /api/login`：登录

### 5.3 用户数据隔离

**实现方式**：
所有业务接口在查询和操作数据时，都会使用 `req.userId` 进行过滤：

```javascript
// 示例：获取记账列表
let where = 'user_id = ?';
const params = [req.userId];
```

**安全保证**：
- 用户只能访问和操作自己的数据
- 即使知道其他用户的记录 ID，也无法访问
- 数据库层面通过 `user_id` 字段实现隔离

## 6. 安全机制

### 6.1 密码安全

**加密方式**：
- 使用 `bcrypt` 进行密码哈希
- 哈希轮数：10（`bcrypt.hash(password, 10)`）

**存储方式**：
- 密码**绝不**明文存储
- 数据库中只存储密码哈希值
- 登录时使用 `bcrypt.compare()` 验证密码

**实现位置**：
- 注册：`backend/server.js` 第 64 行
- 登录：`backend/server.js` 第 97 行

### 6.2 Token 安全

**签名算法**：
- 使用 HS256（HMAC-SHA256）算法
- 密钥通过环境变量配置

**传输安全**：
- Token 通过 HTTP 请求头传输
- 建议在生产环境使用 HTTPS

**存储安全**：
- Token 存储在浏览器 localStorage
- 注意 XSS 攻击风险
- 建议定期检查 Token 有效性

### 6.3 输入验证

**用户名验证**：
- 长度至少 2 位
- 自动去除首尾空格
- 数据库唯一性约束

**密码验证**：
- 长度至少 6 位
- 使用 bcrypt 加密存储

**Token 验证**：
- 检查格式：`Bearer <token>`
- 验证签名和过期时间
- 过期或无效返回 401 错误

## 7. 会话管理

### 7.1 会话生命周期

```
用户注册/登录
    ↓
生成 Token（有效期 7 天）
    ↓
前端保存 Token
    ↓
每次请求携带 Token
    ↓
后端验证 Token
    ↓
Token 过期或用户退出
    ↓
清除 Token，需要重新登录
```

### 7.2 会话状态检查

**前端检查**：
- 页面加载时自动检查 Token
- 调用 `/api/me` 验证 Token 有效性
- Token 无效时自动跳转登录页

**后端检查**：
- 每个受保护接口都通过 `authMiddleware` 验证
- Token 无效返回 401 状态码

### 7.3 多设备登录

**当前实现**：
- 支持同一账号在多设备登录
- 每个设备独立生成 Token
- 无设备管理功能

**限制**：
- 无法查看或管理已登录设备
- 无法强制退出其他设备
- Token 过期后需重新登录

## 8. 错误处理

### 8.1 认证错误

**错误码**：401

**常见错误**：
- `未登录或 token 无效`：请求头中缺少或格式错误的 Token
- `登录已过期，请重新登录`：Token 过期或签名无效

**处理方式**：
- 前端收到 401 错误时清除 Token
- 自动跳转到登录页面
- 显示错误提示信息

### 8.2 业务错误

**错误码**：400、404、500

**常见错误**：
- `用户名和密码不能为空`：注册/登录时参数缺失
- `用户名已存在`：注册时用户名重复
- `用户名或密码错误`：登录时认证失败
- `记录不存在或无权操作`：删除记录时权限检查失败

**处理方式**：
- 前端显示错误信息
- 不自动清除 Token（除非是认证错误）

## 9. 配置说明

### 9.1 环境变量

**后端配置**（`backend/server.js`）：

```javascript
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORT = process.env.PORT || 3000;
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
  JWT_SECRET: ${JWT_SECRET:-dev-secret}
  DB_HOST: mysql
  DB_USER: account_user
  DB_PASSWORD: account_pass
  DB_NAME: account_db
```

**生产环境建议**：
- 使用强随机密钥作为 `JWT_SECRET`
- 使用 `.env` 文件管理敏感配置
- 启用 HTTPS
- 定期轮换密钥

## 10. 最佳实践

### 10.1 前端建议

1. **Token 存储**：
   - 使用 `localStorage` 存储 Token（当前实现）
   - 注意 XSS 攻击风险
   - 考虑使用 `httpOnly` Cookie（需要后端配合）

2. **自动刷新**：
   - 在 Token 即将过期时自动刷新
   - 实现静默登录机制

3. **错误处理**：
   - 统一处理 401 错误
   - 自动跳转登录页
   - 保存用户输入，登录后恢复

### 10.2 后端建议

1. **Token 管理**：
   - 使用强随机密钥
   - 定期轮换密钥
   - 实现 Token 黑名单机制（可选）

2. **安全加固**：
   - 启用 HTTPS
   - 实现请求频率限制
   - 记录登录日志

3. **性能优化**：
   - Token 验证使用缓存（Redis）
   - 数据库查询优化
   - 连接池管理

## 11. 未来优化方向

### 11.1 短期优化

1. **Token 刷新机制**：
   - 实现 Refresh Token
   - 自动刷新即将过期的 Token

2. **记住我功能**：
   - 延长 Token 有效期
   - 提供"记住我"选项

3. **登录日志**：
   - 记录登录时间、IP、设备信息
   - 异常登录提醒

### 11.2 长期优化

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

## 12. 相关文件

- **后端认证中间件**：`backend/server.js` 第 32-46 行
- **注册接口**：`backend/server.js` 第 54-82 行
- **登录接口**：`backend/server.js` 第 85-111 行
- **前端 API 封装**：`frontend/dist/app.js` 第 108-123 行
- **前端登录处理**：`frontend/dist/app.js` 第 718-734 行
- **前端注册处理**：`frontend/dist/app.js` 第 737-753 行
- **前端初始化校验**：`frontend/dist/app.js` 第 981-987 行
- **数据库用户表**：`mysql/init/01-schema.sql`

---

**文档版本**：v1.0  
**最后更新**：2026-02-23  
**维护者**：项目开发团队
