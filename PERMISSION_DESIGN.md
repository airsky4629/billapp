# 权限设计文档

## 1. 概述

本文档描述多用户 H5 记账系统的**权限（认证 + 授权）**设计，与 [登录态设计文档（AUTH_DESIGN.md）](./AUTH_DESIGN.md) 和 [整体设计说明（DESIGN.md）](./DESIGN.md) 配套使用。

### 1.1 权限模型

- **认证（Authentication）**：识别“是谁”（JWT 校验）。详见 [AUTH_DESIGN.md](./AUTH_DESIGN.md)。
- **授权（Authorization）**：判定“能做什么”（接口是否需登录、数据是否归属当前用户）。

当前系统采用 **用户级数据隔离** 模型：

- 无角色（RBAC）：所有已登录用户权限一致。
- 数据归属：业务数据均按 `user_id` 归属，用户仅能访问和操作**本人**数据。
- 接口分级：分为**无需认证**与**需认证**两类；需认证接口在认证通过后，仅能操作当前用户数据。

### 1.2 设计原则

- **最小权限**：未登录仅可访问注册、登录、健康检查；其余操作均需有效登录。
- **数据隔离**：所有列表、统计、增删改均带 `user_id` 条件，避免越权。
- **统一鉴权**：需认证接口统一经 `authMiddleware` 校验，再使用 `req.userId` 做数据隔离。
- **可扩展**：预留扩展点，便于后续引入角色或更细粒度权限。

---

## 2. 认证与授权关系

```
                    ┌─────────────────────────────────────────┐
                    │              请求进入后端                 │
                    └─────────────────────┬─────────────────────┘
                                          │
                    ┌─────────────────────▼─────────────────────┐
                    │  是否为公开接口？                           │
                    │  /api/health | /api/register | /api/login  │
                    │  /api/refresh                             │
                    └─────────────────────┬─────────────────────┘
                          │ 是                    │ 否
                          ▼                       ▼
                    ┌───────────┐         ┌─────────────────────┐
                    │ 直接处理   │         │ authMiddleware       │
                    │ 无需 Token │         │ 校验 JWT + 黑名单    │
                    └───────────┘         └──────────┬──────────┘
                                                       │
                                            ┌──────────▼──────────┐
                                            │ 解析出 req.userId    │
                                            │ req.username        │
                                            └──────────┬──────────┘
                                                       │
                                            ┌──────────▼──────────┐
                                            │ 业务逻辑仅使用       │
                                            │ req.userId 做过滤    │
                                            │ （数据级授权）       │
                                            └─────────────────────┘
```

- **认证**：由 JWT 与黑名单在 `authMiddleware` 中完成。
- **授权**：需认证接口在认证通过后，仅允许操作 `req.userId` 对应的数据（见下文数据权限）。

---

## 3. 接口权限矩阵

### 3.1 接口分类

| 类型         | 说明                     | 认证要求 |
|--------------|--------------------------|----------|
| 公开接口     | 任何人可访问             | 否       |
| 需认证接口   | 需有效 JWT，且仅操作本人数据 | 是       |

### 3.2 接口权限一览

| 方法   | 路径                | 说明           | 认证 | 数据范围     |
|--------|---------------------|----------------|------|--------------|
| GET    | /api/health         | 健康检查       | 否   | -            |
| POST   | /api/register      | 注册           | 否   | -            |
| POST   | /api/login         | 登录           | 否   | -            |
| POST   | /api/refresh       | 刷新 Token     | 否*  | -            |
| GET    | /api/me            | 当前用户信息   | 是   | 当前用户     |
| POST   | /api/logout        | 退出登录       | 是   | 当前用户     |
| GET    | /api/categories    | 分类列表       | 是   | 当前用户     |
| POST   | /api/records       | 新增记账       | 是   | 当前用户     |
| GET    | /api/records       | 记账列表       | 是   | 当前用户     |
| DELETE | /api/records/:id   | 删除记录       | 是   | 当前用户     |
| GET    | /api/summary       | 统计汇总       | 是   | 当前用户     |

\* `/api/refresh` 使用 body 中的 `refreshToken` 校验，不要求请求头中的 Access Token。

### 3.3 实现方式

- **公开接口**：不挂载 `authMiddleware`，直接处理。
- **需认证接口**：路由上使用 `authMiddleware`，例如：

```javascript
app.get('/api/me', authMiddleware, (req, res) => { ... });
app.get('/api/records', authMiddleware, async (req, res) => { ... });
app.delete('/api/records/:id', authMiddleware, async (req, res) => { ... });
```

认证失败（无 Token、Token 无效或过期、在黑名单）统一返回 `401`，前端会尝试刷新 Token 或跳转登录。

---

## 4. 数据权限（用户级隔离）

### 4.1 原则

- 所有与“当前用户”相关的数据操作，必须带 `user_id = req.userId`（或等价形式）。
- 禁止依赖前端传入的 `user_id`；`req.userId` 唯一来源于 JWT，由服务端保证正确性。

### 4.2 资源与权限

| 资源       | 归属字段 | 允许操作                     | 实现要点 |
|------------|----------|------------------------------|----------|
| 用户自身   | users.id | 读取当前用户信息（/api/me）  | 由 JWT 解析出 userId/username |
| 记账记录   | records.user_id | 增、删、查（列表/统计） | 所有 SQL 带 `user_id = ?` 且参数为 `req.userId` |
| 分类       | 来源于 records | 仅当前用户记录中的分类   | 查询 categories 时带 `user_id = ?` |

### 4.3 按接口的数据权限实现

- **GET /api/me**  
  - 仅返回 `req.userId`、`req.username`，不访问其他用户。

- **GET /api/categories**  
  - 从 `records` 表按 `user_id = req.userId` 做 DISTINCT 查询，仅当前用户数据。

- **POST /api/records**  
  - 插入时 `user_id` 固定为 `req.userId`，禁止使用 body 中的 user_id。

- **GET /api/records**  
  - 查询条件包含 `user_id = req.userId`，分页、筛选仅在本用户数据上生效。

- **DELETE /api/records/:id**  
  - 使用 `DELETE ... WHERE id = ? AND user_id = ?`，且 `user_id = req.userId`；若 `affectedRows === 0` 返回 404（记录不存在或无权操作）。

- **GET /api/summary**  
  - 统计条件包含 `user_id = req.userId`，仅汇总当前用户数据。

### 4.4 代码位置参考

| 功能         | 文件              | 说明 |
|--------------|-------------------|------|
| 认证中间件   | backend/server.js  | `authMiddleware`，校验 JWT、黑名单，写入 `req.userId` / `req.username` |
| 分类查询     | backend/server.js  | `GET /api/categories`，`where = 'user_id = ?'` + `params = [userId]` |
| 新增记录     | backend/server.js  | `POST /api/records`，`INSERT ... user_id = req.userId` |
| 列表查询     | backend/server.js  | `GET /api/records`，`where = 'user_id = ?'` + `params = [req.userId]` |
| 删除记录     | backend/server.js  | `DELETE /api/records/:id`，`WHERE id = ? AND user_id = ?` |
| 统计         | backend/server.js  | `GET /api/summary`，`where = 'user_id = ?'` + `params = [req.userId]` |

---

## 5. 安全约束与最佳实践

### 5.1 必须遵守的规则

1. **所有需认证接口**  
   - 必须经过 `authMiddleware`，不得通过“可选认证”或仅靠参数判断身份。

2. **所有涉及 records 的 SQL**  
   - 必须包含 `user_id = ?` 且绑定 `req.userId`，不能仅凭 `id` 或前端参数操作。

3. **错误信息**  
   - 未授权访问时返回 401（未登录/Token 无效）或 404（记录不存在或无权操作），不暴露是否存在某条记录或是否属于其他用户。

4. **新增接口**  
   - 若操作用户数据，必须使用 `req.userId` 做隔离，并列入本文档的接口权限矩阵。

### 5.2 与认证文档的衔接

- Token 的生成、刷新、黑名单、过期策略等均在 [AUTH_DESIGN.md](./AUTH_DESIGN.md) 中说明。
- 本权限文档只约定：**认证通过后，授权规则为“仅能操作当前用户数据”**。

### 5.3 前端与权限

- 前端根据是否拥有有效 Token 决定展示登录页或主页；敏感操作一律依赖后端接口。
- 前端不应根据“角色”或“权限码”隐藏接口调用；权限以后端为准，前端仅做体验优化（如未登录时跳转登录页）。

---

## 6. 扩展与预留

### 6.1 当前模型小结

- **角色**：无。所有已登录用户权限一致（仅限本人数据）。
- **权限粒度**：接口级（是否需登录）+ 数据级（user_id 隔离）。

### 6.2 未来可扩展方向

若后续需要更复杂权限，可考虑：

- **角色（RBAC）**：在 `users` 表增加 `role`（如 `user` / `admin`），在 `authMiddleware` 后增加 `requireRole('admin')` 等，用于管理端接口。
- **资源级权限**：若出现“共享账本”等，可引入“账本-用户”关联表，授权时校验当前用户是否对该资源有读/写权限。
- **审计**：对敏感操作（删除、导出等）记录操作人、资源 ID、时间，便于审计与追溯。

扩展时建议在本文档中更新接口权限矩阵和数据权限表，并保持与 [AUTH_DESIGN.md](./AUTH_DESIGN.md) 一致。

---

## 7. 相关文档与文件

| 文档/文件           | 说明 |
|---------------------|------|
| [AUTH_DESIGN.md](./AUTH_DESIGN.md) | 登录态、Token、安全加固等认证设计 |
| [DESIGN.md](./DESIGN.md)           | 系统架构、多用户与安全、API 总览 |
| [SECURITY_IMPROVEMENTS.md](./SECURITY_IMPROVEMENTS.md) | 安全改进说明 |
| backend/server.js   | 认证中间件与各接口的数据权限实现 |
| mysql/init/01-schema.sql | users、records 等表结构（含 user_id 外键） |

---

**文档版本**：v1.0  
**最后更新**：2026-02-23
