# 多用户 H5 记账系统 - 设计说明

## 1. 项目概述

本项目是一个基于 H5 的多用户记账应用，采用前后端分离与独立容器部署：

- **前端**：纯 H5 页面（HTML/CSS/JS），由 Nginx 提供静态资源并代理 API。
- **后端**：Node.js + Express 提供 REST API，负责用户认证与记账 CRUD。
- **数据库**：MySQL 8.0，存储用户与记账记录。

三个部分分别构建为独立 Docker 镜像，通过 Docker Compose 统一编排与一键启动。

## 2. 系统架构

```
                    ┌─────────────────┐
                    │   用户浏览器     │
                    └────────┬────────┘
                             │ http://localhost:8080
                             ▼
                    ┌─────────────────┐
                    │  Frontend       │  (Nginx 镜像)
                    │  :8080 → 80     │  - 静态页面
                    │  /api/* → 后端   │  - 反向代理
                    └────────┬────────┘
                             │ http://backend:3000
                             ▼
                    ┌─────────────────┐
                    │  Backend        │  (Node 镜像)
                    │  :3000          │  - 注册/登录(JWT)
                    │                 │  - 记账 CRUD、统计
                    └────────┬────────┘
                             │ 3306
                             ▼
                    ┌─────────────────┐
                    │  MySQL          │  (MySQL 8.0 镜像)
                    │  :3306          │  - users
                    │                 │  - records
                    └─────────────────┘
```

## 3. 多用户与安全

- **用户体系**：每个用户独立注册、登录，数据按 `user_id` 隔离。
- **认证方式**：登录/注册成功后下发 JWT，前端在请求头 `Authorization: Bearer <token>` 中携带。
- **密码**：使用 bcrypt 哈希存储，不明文保存。
- **接口权限**：除 `/api/register`、`/api/login`、`/api/health` 外，其余接口均需有效 JWT，且仅能操作当前用户数据。

## 4. 数据库设计

### 4.1 表结构

| 表名     | 说明     |
|----------|----------|
| users    | 用户表   |
| records  | 记账记录表 |

**users**

- `id`：主键
- `username`：唯一，用于登录
- `password_hash`：bcrypt 哈希
- `nickname`：可选昵称
- `created_at` / `updated_at`

**records**

- `id`：主键
- `user_id`：外键 → users.id，实现多用户隔离
- `type`：`income` | `expense`
- `amount`：金额（DECIMAL）
- `category`：分类（如餐饮、交通）
- `note`：备注
- `record_date`：记账日期
- `created_at`

### 4.2 初始化

- 脚本位于 `mysql/init/01-schema.sql`，由 MySQL 镜像在首次启动时自动执行，创建库表。

## 5. 后端 API 设计

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET  | /api/health | 健康检查 | 否 |
| POST | /api/register | 注册 | 否 |
| POST | /api/login | 登录 | 否 |
| GET  | /api/me | 当前用户信息 | 是 |
| POST | /api/records | 新增记账 | 是 |
| GET  | /api/records | 列表（分页、日期、类型筛选） | 是 |
| DELETE | /api/records/:id | 删除记录 | 是 |
| GET  | /api/summary | 收入/支出/结余统计 | 是 |

列表与统计支持 `startDate`、`endDate`、`type`(income/expense) 等查询参数。

## 6. 前端功能

- **登录/注册**：Tab 切换，表单提交后保存 token 与用户名到 localStorage，并跳转主页。
- **首页**：展示当前用户在本月（或筛选区间）的收入、支出、结余；列表展示记录，支持按日期范围与类型筛选；可新增收入/支出、删除记录。
- **会话**：刷新页面时通过 `/api/me` 校验 token，无效则退回登录页；退出清除本地 token 并回到登录页。

## 7. Docker 与编排

- **镜像**：
  - `mysql:8.0`：官方镜像 + 挂载 `mysql/init` 做初始化。
  - `backend`：基于 `node:18-alpine`，构建目录 `./backend`。
  - `frontend`：基于 `nginx:alpine`，构建目录 `./frontend`，将 `frontend/dist` 与 `nginx.conf` 打入镜像。
- **网络**：Compose 默认网络下，服务名 `mysql`、`backend`、`frontend` 可互相解析。
- **依赖与健康**：MySQL 配置 healthcheck；backend 依赖 MySQL 健康后再启动；frontend 依赖 backend（仅启动顺序，无健康依赖）。
- **数据持久化**：MySQL 数据卷 `mysql_data`，重启不丢数据。

## 8. 配置与扩展

- 数据库账号、JWT 密钥等通过 Compose 的 `environment` 传入，生产环境建议使用 `.env` 或密钥管理，并修改默认密码与 `JWT_SECRET`。
- 需对外暴露的端口：前端 8080、后端 3000、MySQL 3306（可按需去掉端口映射或改端口）。

以上即为本项目的整体设计说明，便于维护与二次开发。
