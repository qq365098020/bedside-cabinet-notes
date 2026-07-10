#!/bin/bash
# 价格行为交易复盘 APP 自动部署脚本
# 用法: bash deploy.sh "提交信息"
set -e

REPO="/home/oiio/Codex的工作台/价格行为交易复盘"
OWNER="qq365098020"
REMOTE_REPO="price-action-review-app"
BRANCH="main"
COMMIT_MSG="${1:-auto deploy}"

TZ=Asia/Shanghai
TIMESTAMP=$(TZ=$TZ date +"%Y%m%d-%H%M")

sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$TIMESTAMP\"/" "$REPO/manifest.json"
sed -i "s|\"start_url\": \"[^\"]*\"|\"start_url\": \"./index.html?v=$TIMESTAMP\"|" "$REPO/manifest.json"
printf '{"version":"%s"}\n' "$TIMESTAMP" > "$REPO/version.json"
sed -i "s|<meta name=\"version\" content=\"[^\"]*\">|<meta name=\"version\" content=\"$TIMESTAMP\">|" "$REPO/index.html"
sed -i "s|const CACHE_NAME = \"[^\"]*\"|const CACHE_NAME = \"price-action-review-v$TIMESTAMP\"|" "$REPO/sw.js"

TOKEN=$(strings -e l ~/桌面/各种API\ Key.wps 2>/dev/null | grep 'ghp_' | head -1)
if [ -z "$TOKEN" ]; then
  echo "GitHub token not found"
  exit 1
fi

cd "$REPO"
git add -A
git commit -m "v${TIMESTAMP}: ${COMMIT_MSG}" || true
git push "https://${OWNER}:${TOKEN}@github.com/${OWNER}/${REMOTE_REPO}.git" "$BRANCH"

PAGES_HTTP=$(curl -sS -o /tmp/price_action_pages_status.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/${OWNER}/${REMOTE_REPO}/pages")

echo ""
echo "推送成功"
echo "版本: ${TIMESTAMP}"
if [ "$PAGES_HTTP" = "200" ]; then
  echo "链接: https://${OWNER}.github.io/${REMOTE_REPO}/?v=${TIMESTAMP}"
else
  echo "GitHub Pages 当前未启用，公开链接不会更新。"
fi
