#!/bin/bash
# 前端一键构建脚本：生成图标子集 -> 构建 -> 修正静态文件权限
set -e
cd /opt/tgproxy/frontend
export PATH=/usr/local/bin:$PATH
npm run build
find /opt/tgproxy/frontend -maxdepth 1 -type d -exec chmod 755 {} \;
chmod -R a+rX /opt/tgproxy/frontend/dist
echo "✅ 前端构建完成"
