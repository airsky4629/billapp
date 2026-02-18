#!/bin/bash
# 关闭本项目的所有容器（MySQL、后端、前端）

set -e
cd "$(dirname "$0")"

# 统一 compose 命令
COMPOSE_CMD=""
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE_CMD="docker-compose"
fi

if ! command -v docker &>/dev/null; then
  echo "错误: 未找到 docker，请先安装 Docker。"
  exit 1
fi
if [ -z "$COMPOSE_CMD" ]; then
  echo "错误: 未找到 docker compose，请先安装 Docker Compose。"
  exit 1
fi

echo ">>> 正在关闭所有服务（MySQL、后端、前端）..."
$COMPOSE_CMD down

echo ""
echo ">>> 所有容器已关闭。"
echo "    如需同时删除数据卷，请执行: $COMPOSE_CMD down -v"
echo ""
