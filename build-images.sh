#!/bin/bash
# 一键构建当前项目中所有 Docker 镜像

set -e
cd "$(dirname "$0")"

# 选择构建镜像架构
echo ">>> 选择要构建的镜像架构类型："
echo "  1) 使用本机默认架构（推荐，通常是 arm64/x86_64）"
echo "  2) 强制构建为 x86 架构镜像 (linux/amd64)"
read -p "请输入选项 [1/2]，直接回车默认为 1: " ARCH_CHOICE

# compose 文件选择：默认用 docker-compose.yml；选 2 时叠加 amd64 覆盖文件
COMPOSE_FILES=(-f docker-compose.yml)
case "${ARCH_CHOICE:-1}" in
  2)
    COMPOSE_FILES+=(-f docker-compose.amd64.yml)
    echo ">>> 已选择：强制构建为 x86 (linux/amd64) 镜像"
    ;;
  *)
    echo ">>> 已选择：使用本机默认架构构建镜像"
    ;;
esac

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
$COMPOSE_CMD "${COMPOSE_FILES[@]}" build

echo ""
echo ">>> 构建完成，当前 billapp 相关镜像："
docker images | awk 'NR==1 || $1 ~ /billapp/'
echo ""
echo "如需一键启动服务，可在本目录执行: ./start.sh"

