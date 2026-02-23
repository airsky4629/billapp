#!/bin/bash
# 一键将当前项目(含 docker-compose 与镜像相关文件)提交并推送到 GitHub

set -e
cd "$(dirname "$0")"

if ! command -v git &>/dev/null; then
  echo "错误: 未找到 git，请先安装 Git。"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "错误: 当前目录不是 Git 仓库，请在项目根目录下执行。"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo "")"

if [ -z "$REMOTE_URL" ]; then
  echo "错误: 未配置远程仓库 origin，请先执行:"
  echo "  git remote add origin <你的 GitHub 仓库地址>"
  exit 1
fi

DEFAULT_MSG="chore: update docker compose & images"
COMMIT_MSG="${1:-$DEFAULT_MSG}"

echo ">>> 当前分支: $BRANCH"
echo ">>> 远程仓库: $REMOTE_URL"
echo ">>> 提交说明: $COMMIT_MSG"
echo ""

echo ">>> 暂存所有变更(包括 docker-compose.yml 与 Dockerfile 等)..."
git add .

echo ""
echo ">>> 当前变更预览:"
git status
echo ""

read -p "确认提交并推送到 GitHub? (y/N): " ANSWER
case "${ANSWER:-n}" in
  y|Y|yes|YES)
    echo ">>> 正在提交..."
    if ! git commit -m "$COMMIT_MSG"; then
      echo "提示: 没有新的变更需要提交，跳过 commit。"
    fi
    echo ">>> 正在推送到 origin/$BRANCH ..."
    git push origin "$BRANCH"
    echo ">>> 推送完成。"
    ;;
  *)
    echo "已取消推送。"
    exit 0
    ;;
esac

