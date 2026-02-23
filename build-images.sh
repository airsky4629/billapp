#!/bin/bash
# 一键构建当前项目中所有 Docker 镜像

set -e
cd "$(dirname "$0")"

# 统一 compose 命令
COMPOSE_CMD=""
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE_CMD="docker-compose"
fi

echo ">>> 检查 Docker 与 Docker Compose..."
if ! command -v docker &>/dev/null; then
  echo "错误: 未找到 docker，请先安装 Docker。"
  exit 1
fi
if [ -z "$COMPOSE_CMD" ]; then
  echo "错误: 未找到 docker compose，请先安装 Docker Compose。"
  exit 1
fi

echo ">>> 根据 docker-compose.yml 构建所有镜像..."
$COMPOSE_CMD build

echo ""
echo ">>> 构建完成，当前 billapp 相关镜像："
docker images | awk 'NR==1 || $1 ~ /billapp/'
echo ""
echo "如需一键启动服务，可在本目录执行: ./start.sh"

