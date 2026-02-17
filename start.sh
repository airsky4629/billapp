#!/bin/bash
# 一键启动脚本：构建并启动 MySQL、后端、前端 三个服务

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

# 检测是否有本项目的容器已在运行
RUNNING=$($COMPOSE_CMD ps -q 2>/dev/null | head -1)
if [ -n "$RUNNING" ]; then
  echo ">>> 检测到当前项目已有容器在运行："
  $COMPOSE_CMD ps
  echo ""
  read -p "是否先关闭当前进程再启动？(y/N): " ANSWER
  case "${ANSWER:-n}" in
    y|Y|yes|YES)
      read -p "是否同时重启 MySQL？(y/N，选 N 则仅重启后端与前端，保留 MySQL 及数据): " RESTART_MYSQL
      case "${RESTART_MYSQL:-n}" in
        y|Y|yes|YES)
          echo ">>> 正在关闭所有服务（含 MySQL）..."
          $COMPOSE_CMD down
          echo ">>> 已关闭，开始重新构建并启动..."
          ;;
        *)
          echo ">>> 正在仅关闭后端与前端（保留 MySQL）..."
          $COMPOSE_CMD stop backend frontend 2>/dev/null || true
          echo ">>> 已关闭应用服务，开始重新构建并启动..."
          ;;
      esac
      ;;
    *)
      echo "已取消启动。如需重启请先执行: $COMPOSE_CMD down"
      exit 0
      ;;
  esac
fi

echo ">>> 构建并启动所有服务..."
$COMPOSE_CMD up -d --build

echo ""
echo ">>> 等待 MySQL 就绪..."
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec billapp-mysql mysqladmin ping -h localhost -u root -prootpass &>/dev/null; then
    echo "MySQL 已就绪"
    break
  fi
  echo "  等待中... ($i/10)"
  sleep 3
done

echo ""
echo "=========================================="
echo "  服务已启动"
echo "=========================================="
echo "  前端页面:  http://localhost:8080"
echo "  后端 API:  http://localhost:3000"
echo "  MySQL:     localhost:3306 (用户 account_user / account_pass，库 account_db)"
echo "=========================================="
echo ""
echo "停止服务请在本目录执行: $COMPOSE_CMD down"
echo ""
