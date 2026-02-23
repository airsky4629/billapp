#!/bin/bash
# 一键构建镜像 + 提交代码到 GitHub + 推送镜像到镜像仓库
#
# 用法:
#   ./deploy-all.sh                   # 使用默认提交信息
#   ./deploy-all.sh "feat: xxx"       # 自定义提交信息
#
# 镜像推送说明:
#   - 本项目会构建本地镜像: billapp-backend, billapp-frontend
#   - 如需推送到远程镜像仓库，请在执行脚本前:
#       1) 先登录镜像仓库 (例如 Docker Hub / GHCR):
#          docker login
#       2) 通过环境变量或运行时输入设定前缀, 例如:
#          export IMAGE_REGISTRY_PREFIX="ghcr.io/airsky4629"
#          或
#          export IMAGE_REGISTRY_PREFIX="docker.io/airsky4629"

set -e
cd "$(dirname "$0")"

###########################################################
# 工具检查
###########################################################

if ! command -v git &>/dev/null; then
  echo "错误: 未找到 git，请先安装 Git。"
  exit 1
fi

###########################################################
# 选择镜像架构（与 start.sh / build-images.sh 保持一致）
###########################################################

echo ">>> 选择要构建并部署的镜像架构类型："
echo "  1) 使用本机默认架构（推荐，通常是 arm64/x86_64）"
echo "  2) 强制使用 x86 架构镜像 (linux/amd64)"
read -p "请输入选项 [1/2]，直接回车默认为 1: " ARCH_CHOICE

COMPOSE_FILES=(-f docker-compose.yml)
case "${ARCH_CHOICE:-1}" in
  2)
    COMPOSE_FILES+=(-f docker-compose.amd64.yml)
    echo ">>> 已选择：强制使用 x86 (linux/amd64) 镜像进行构建与推送"
    ;;
  *)
    echo ">>> 已选择：使用本机默认架构进行构建与推送"
    ;;
esac

if ! command -v docker &>/dev/null; then
  echo "错误: 未找到 docker，请先安装 Docker。"
  exit 1
fi

COMPOSE_CMD=""
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE_CMD="docker-compose"
fi

if [ -z "$COMPOSE_CMD" ]; then
  echo "错误: 未找到 docker compose，请先安装 Docker Compose。"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "错误: 当前目录不是 Git 仓库，请在项目根目录下执行。"
  exit 1
fi

REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo "")"
if [ -z "$REMOTE_URL" ]; then
  echo "错误: 未配置远程仓库 origin，请先执行:"
  echo "  git remote add origin <你的 GitHub 仓库地址>"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DEFAULT_MSG="chore: build images & push code"
COMMIT_MSG="${1:-$DEFAULT_MSG}"

echo "=========================================="
echo "  一键部署流程"
echo "------------------------------------------"
echo "  分支:  $BRANCH"
echo "  远程:  $REMOTE_URL"
echo "  提交:  $COMMIT_MSG"
echo "=========================================="
echo ""

###########################################################
# 第一步：构建 Docker 镜像
###########################################################

echo ">>> [1/3] 构建 Docker 镜像..."
case "${ARCH_CHOICE:-1}" in
  2)
    echo ">>> 使用 docker build 强制构建 x86 (linux/amd64) 镜像..."

    echo ">>> 构建 backend 镜像 (linux/amd64)..."
    docker build --platform linux/amd64 -t billapp-backend ./backend

    echo ">>> 构建 frontend 镜像 (linux/amd64)..."
    docker build --platform linux/amd64 -t billapp-frontend ./frontend
    ;;
  *)
    echo ">>> 根据 docker-compose.yml 构建镜像（本机默认架构）..."
    $COMPOSE_CMD -f docker-compose.yml build
    ;;
esac

echo ""
echo ">>> 构建完成，本地 billapp 相关镜像："
docker images | awk 'NR==1 || $1 ~ /billapp/'
echo ""

###########################################################
# 第二步：提交并推送代码到 GitHub
###########################################################

echo ">>> [2/3] 暂存并推送代码到 GitHub..."
git add .

echo ""
echo ">>> 当前变更预览:"
git status
echo ""

read -p "确认提交并推送代码到 GitHub? (y/N): " ANSWER_CODE
case "${ANSWER_CODE:-n}" in
  y|Y|yes|YES)
    echo ">>> 正在提交代码..."
    if ! git commit -m "$COMMIT_MSG"; then
      echo "提示: 没有新的变更需要提交，跳过 commit。"
    fi
    echo ">>> 正在推送到 origin/$BRANCH ..."
    git push origin "$BRANCH"
    echo ">>> 代码推送完成。"
    ;;
  *)
    echo "已取消代码推送，后续镜像推送步骤也将跳过。"
    exit 0
    ;;
esac

###########################################################
# 第三步：推送镜像到镜像仓库
###########################################################

echo ""
echo ">>> [3/3] 推送镜像到镜像仓库 (可选)..."

# 优先使用环境变量，其次交互输入
if [ -z "$IMAGE_REGISTRY_PREFIX" ]; then
  read -p "请输入镜像仓库前缀(例如 ghcr.io/airsky4629 或 docker.io/airsky4629，留空则跳过镜像推送): " INPUT_PREFIX
  IMAGE_REGISTRY_PREFIX="$INPUT_PREFIX"
fi

if [ -z "$IMAGE_REGISTRY_PREFIX" ]; then
  echo "未设置镜像仓库前缀，跳过镜像推送。"
  echo "如需推送，请设置环境变量 IMAGE_REGISTRY_PREFIX 后重新执行。"
  exit 0
fi

echo "镜像仓库前缀: $IMAGE_REGISTRY_PREFIX"
read -p "确认推送 billapp-backend 与 billapp-frontend 到上述仓库? (y/N): " ANSWER_IMG
case "${ANSWER_IMG:-n}" in
  y|Y|yes|YES)
    TAG_SUFFIX="latest"

    BACKEND_LOCAL="billapp-backend:latest"
    FRONTEND_LOCAL="billapp-frontend:latest"

    BACKEND_REMOTE="${IMAGE_REGISTRY_PREFIX}/billapp-backend:${TAG_SUFFIX}"
    FRONTEND_REMOTE="${IMAGE_REGISTRY_PREFIX}/billapp-frontend:${TAG_SUFFIX}"

    echo ">>> 标记并推送后端镜像: $BACKEND_REMOTE"
    docker tag "$BACKEND_LOCAL" "$BACKEND_REMOTE"
    docker push "$BACKEND_REMOTE"

    echo ">>> 标记并推送前端镜像: $FRONTEND_REMOTE"
    docker tag "$FRONTEND_LOCAL" "$FRONTEND_REMOTE"
    docker push "$FRONTEND_REMOTE"

    echo ">>> 镜像推送完成。"
    ;;
  *)
    echo "已取消镜像推送。"
    ;;
esac

echo ""
echo "=========================================="
echo "  部署流程已完成"
echo "  1) 镜像已构建"
echo "  2) 代码已推送到 GitHub (如确认执行)"
echo "  3) 镜像已推送到镜像仓库 (如确认执行)"
echo "=========================================="

