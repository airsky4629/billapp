# 登录安全优化改进说明

## 概述

本次更新对登录认证系统进行了全面的安全加固，提升了系统的安全性和用户体验。

## 主要改进

### 1. 双 Token 机制 ✅

**改进前**：
- 单一 JWT Token，有效期 7 天
- Token 过期后需要重新登录

**改进后**：
- **Access Token**：1 小时有效期，用于日常 API 请求
- **Refresh Token**：7 天有效期，用于刷新 Access Token
- 前端自动刷新机制，用户无感知

**优势**：
- 更短的 Access Token 有效期，降低泄露风险
- 自动刷新，提升用户体验
- 符合 OAuth 2.0 最佳实践

### 2. 登录失败次数限制 ✅

**新增功能**：
- 登录失败 5 次后锁定账户 15 分钟
- 防止暴力破解攻击
- 显示剩余锁定时间

**实现**：
- 数据库字段：`login_attempts`、`locked_until`
- 登录失败时自动增加失败次数
- 达到阈值后自动锁定账户

### 3. Token 黑名单机制 ✅

**新增功能**：
- 退出登录时使 Token 立即失效
- 防止已退出的 Token 被继续使用
- 定期清理过期的黑名单记录

**实现**：
- 新增 `token_blacklist` 表
- Token Hash 存储，保护隐私
- 每次验证 Token 时检查黑名单

### 4. 密码强度验证增强 ✅

**改进前**：
- 密码至少 6 位

**改进后**：
- 密码至少 8 位，最多 128 位
- 必须包含至少一个数字
- 必须包含至少一个字母
- 禁止常见弱密码（12345678, password 等）

**优势**：
- 提升密码安全性
- 防止用户使用弱密码
- 符合密码安全最佳实践

### 5. 用户名验证增强 ✅

**新增功能**：
- 用户名长度：2-50 位
- 只允许字母、数字、下划线、中文
- 自动去除首尾空格

**优势**：
- 防止特殊字符注入
- 统一用户名格式
- 提升数据质量

### 6. 请求频率限制 ✅

**新增功能**：
- **登录接口**：15 分钟内最多 5 次请求
- **API 接口**：1 分钟内最多 100 次请求
- 超出限制返回 429 状态码

**优势**：
- 防止 API 滥用
- 防止暴力破解攻击
- 保护服务器资源

### 7. 安全响应头 ✅

**新增功能**：
- 使用 Helmet 中间件
- 添加安全响应头：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - 其他安全头

**优势**：
- 防止 XSS 攻击
- 防止点击劫持
- 提升整体安全性

### 8. 登录日志记录 ✅

**新增功能**：
- 记录所有登录尝试
- 包含信息：用户 ID、用户名、IP、User-Agent、结果、失败原因
- 新增 `login_logs` 表

**优势**：
- 安全审计
- 异常登录检测
- 攻击分析

### 9. 密码加密强度提升 ✅

**改进前**：
- bcrypt 轮数：10

**改进后**：
- bcrypt 轮数：12

**优势**：
- 提升密码哈希强度
- 增加破解难度

### 10. CORS 配置优化 ✅

**改进**：
- 支持环境变量配置
- 生产环境可限制特定域名
- 支持凭证传递

## 数据库变更

### 新增表

1. **token_blacklist**：Token 黑名单表
   - `token_hash`：Token 哈希值
   - `user_id`：用户 ID
   - `expires_at`：过期时间

2. **login_logs**：登录日志表
   - `user_id`：用户 ID（可为空）
   - `username`：用户名
   - `ip_address`：IP 地址
   - `user_agent`：User-Agent
   - `success`：是否成功
   - `failure_reason`：失败原因

### 用户表新增字段

- `login_attempts`：登录失败次数
- `locked_until`：账户锁定到期时间
- `last_login_at`：最后登录时间
- `last_login_ip`：最后登录 IP

## API 变更

### 新增接口

1. **POST /api/refresh**
   - 刷新 Access Token
   - 请求体：`{ "refreshToken": "..." }`
   - 响应：`{ "code": 0, "token": "新的 access token" }`

2. **POST /api/logout**
   - 退出登录
   - 需要认证
   - 将当前 Token 加入黑名单

### 接口响应变更

**注册和登录接口**：
- 新增 `refreshToken` 字段
- `token` 字段改为 Access Token（1小时有效期）

**错误响应**：
- 新增 423 状态码：账户锁定
- 新增 429 状态码：请求频率限制

## 前端变更

### Token 存储

- 新增 `localStorage.refreshToken` 存储 Refresh Token
- `localStorage.token` 存储 Access Token

### API 函数增强

- 自动检测 401 错误
- 自动刷新 Token
- 使用新 Token 重试请求
- 用户无感知

### 退出登录

- 调用 `/api/logout` 接口
- 使 Token 立即失效
- 清除所有 Token 和用户信息

## 配置变更

### 环境变量

**新增**：
- `JWT_REFRESH_SECRET`：Refresh Token 签名密钥
- `CORS_ORIGIN`：CORS 允许的来源（生产环境建议限制）

### Docker Compose

```yaml
environment:
  JWT_SECRET: your-jwt-secret-change-in-production
  JWT_REFRESH_SECRET: your-jwt-refresh-secret-change-in-production
  CORS_ORIGIN: "*"
```

## 依赖变更

### 新增依赖

- `express-rate-limit`：请求频率限制
- `helmet`：安全响应头

### package.json

```json
{
  "dependencies": {
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0"
  }
}
```

## 升级步骤

### 1. 更新依赖

```bash
cd backend
npm install
```

### 2. 更新数据库

数据库 schema 会自动更新（通过 `mysql/init/01-schema.sql`）

如果已有数据，需要手动执行迁移：

```sql
-- 添加用户表新字段
ALTER TABLE users 
ADD COLUMN login_attempts INT DEFAULT 0,
ADD COLUMN locked_until TIMESTAMP NULL,
ADD COLUMN last_login_at TIMESTAMP NULL,
ADD COLUMN last_login_ip VARCHAR(45);

-- 创建 Token 黑名单表
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

-- 创建登录日志表
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

### 3. 更新环境变量

在 `docker-compose.yml` 或 `.env` 文件中添加：

```yaml
JWT_REFRESH_SECRET: your-jwt-refresh-secret-change-in-production
CORS_ORIGIN: "*"  # 生产环境改为实际域名
```

### 4. 重新构建和启动

```bash
docker compose down
docker compose up -d --build
```

### 5. 用户影响

- **现有用户**：需要重新登录（因为 Token 格式变更）
- **新用户**：注册时密码需要符合新规则（至少8位，包含数字和字母）

## 安全建议

### 生产环境配置

1. **密钥管理**：
   - 使用强随机密钥（至少 32 字符）
   - 定期轮换密钥
   - 使用密钥管理服务（如 AWS Secrets Manager）

2. **HTTPS**：
   - 启用 HTTPS
   - 使用有效的 SSL 证书
   - 配置 HSTS

3. **CORS**：
   - 限制 `CORS_ORIGIN` 为实际的前端域名
   - 不要使用 `*`

4. **监控**：
   - 监控登录失败次数
   - 监控异常登录行为
   - 设置告警规则

5. **日志**：
   - 定期清理登录日志
   - 保留必要的审计日志
   - 使用日志分析工具

## 测试建议

### 功能测试

1. **注册测试**：
   - 测试密码强度验证
   - 测试用户名格式验证
   - 验证返回的 Token 和 Refresh Token

2. **登录测试**：
   - 测试正常登录
   - 测试密码错误（验证失败次数限制）
   - 测试账户锁定和解锁
   - 验证返回的 Token 和 Refresh Token

3. **Token 刷新测试**：
   - 测试 Access Token 过期后自动刷新
   - 测试 Refresh Token 过期后需要重新登录

4. **退出登录测试**：
   - 测试退出后 Token 失效
   - 测试退出后无法使用旧 Token

5. **频率限制测试**：
   - 测试登录接口频率限制
   - 测试 API 接口频率限制

### 安全测试

1. **暴力破解测试**：
   - 尝试多次错误密码登录
   - 验证账户锁定机制

2. **Token 安全测试**：
   - 测试使用已退出的 Token
   - 测试使用过期的 Token
   - 测试使用无效的 Token

3. **密码安全测试**：
   - 测试弱密码拒绝
   - 测试密码强度验证

## 回滚方案

如果需要回滚到旧版本：

1. 恢复 `backend/server.js` 到旧版本
2. 恢复 `frontend/dist/app.js` 到旧版本
3. 恢复 `backend/package.json` 到旧版本
4. 移除新增的数据库表和字段（可选）

**注意**：回滚后用户需要重新登录。

## 相关文档

- [登录态设计文档](./AUTH_DESIGN.md)：认证与登录态设计
- [权限设计文档](./PERMISSION_DESIGN.md)：接口与数据权限设计
- [README.md](./README.md)：项目使用说明
- [DESIGN.md](./DESIGN.md)：整体设计说明

---

**更新日期**：2026-02-23  
**版本**：v2.0
