# 多用户 H5 记账系统

基于 H5 的多用户记账应用，前端、后端、MySQL 分别使用独立 Docker 镜像，通过 Docker Compose 一键启动。

## 目录结构

```
.
├── docker-compose.yml   # 编排：mysql / backend / frontend
├── start.sh             # 一键启动脚本
├── stop.sh              # 一键关闭所有容器
├── DESIGN.md            # 设计说明
├── AUTH_DESIGN.md       # 登录态与认证设计
├── PERMISSION_DESIGN.md # 权限设计
├── README.md            # 本文件：使用方式与测试访问
├── mysql/
│   └── init/
│       └── 01-schema.sql  # 数据库初始化
├── backend/             # 后端 API（Node.js + Express）
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── frontend/            # 前端 H5（Nginx 静态 + 代理）
    ├── Dockerfile
    ├── nginx.conf
    └── dist/
        ├── index.html
        ├── style.css
        └── app.js
```

## 环境要求

- 已安装 [Docker](https://docs.docker.com/get-docker/)
- 已安装 [Docker Compose](https://docs.docker.com/compose/install/)（或 Docker 内置 `docker compose`）

## 一键启动脚本使用方式

### 1. 赋予执行权限（首次）

```bash
chmod +x start.sh
```

### 2. 启动所有服务

在项目根目录执行：

```bash
./start.sh
```

脚本会：

- 检查本机是否已安装 Docker 与 Docker Compose
- 使用 `docker compose up -d --build`（或 `docker-compose up -d --build`）构建并启动三个服务
- 等待 MySQL 就绪
- 在终端输出访问地址与端口说明

### 3. 停止服务

在项目根目录执行（推荐使用脚本）：

```bash
./stop.sh
```

或直接使用 compose 命令：

```bash
docker compose down
# 或
docker-compose down
```

如需同时删除 MySQL 数据卷（清空所有数据）：

```bash
docker compose down -v
```

### 4. 仅重新构建某一服务

例如只重建后端并启动：

```bash
docker compose up -d --build backend
```

## 测试访问方式

### 前端页面（主要入口）

- 地址：**http://localhost:8080**
- 说明：在浏览器打开即可使用记账功能；未登录会先进入登录/注册页。

### 后端 API

- 地址：**http://localhost:3000**
- 健康检查：`GET http://localhost:3000/api/health`  
  预期返回：`{"ok":true}`

### MySQL 数据库

- 主机：`localhost`
- 端口：`3306`
- 数据库名：`account_db`
- 用户：`account_user`
- 密码：`account_pass`
- 根密码：`rootpass`（仅用于容器内管理，如 `docker exec` 进入容器）

### 建议测试流程

1. 打开 **http://localhost:8080**。
2. 在「注册」Tab 下注册新用户（例如用户名 `test`，密码 `123456`）。
3. 注册成功会自动登录并进入首页；或切换到「登录」Tab 使用已有账号登录。
4. 在首页点击「+ 记支出」「+ 记外债」（选择借出或人情往来）添加几条记录，确认列表与顶部支出/借出/人情往来统计是否正确。
5. 使用筛选条件（日期范围、类型）后点击「查询」，确认列表与统计是否随筛选变化。
6. 删除某条记录，确认列表与统计是否更新。
7. 点击「退出」后再次打开 **http://localhost:8080**，应回到登录页；用同一账号登录可看到该用户自己的数据，实现多用户隔离。

### 使用 curl 快速测 API（可选）

```bash
# 健康检查
curl -s http://localhost:3000/api/health

# 注册（返回 token）
curl -s -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test2","password":"123456"}'

# 使用返回的 token 访问需登录的接口（将 YOUR_TOKEN 替换为实际 token）
curl -s http://localhost:3000/api/me -H "Authorization: Bearer YOUR_TOKEN"
```

通过前端访问时，所有 `/api` 请求会由 Nginx 代理到后端，因此直接访问 **http://localhost:8080** 即可完成完整业务流程测试。

## 设计说明

更详细的说明见工程根目录下文档：

- **DESIGN.md**：架构、多用户与安全、数据库表结构、API 设计、Docker 编排
- **AUTH_DESIGN.md**：登录态与认证设计（Token、安全加固）
- **PERMISSION_DESIGN.md**：权限设计（接口权限与数据隔离）
