@echo off
chcp 65001 >nul
title 水利工程质量安全合规管理助手
cd /d "%~dp0"

REM ============================================================
REM  如需启用「真实 AI 视觉识别」，请取消下面 3 行的 rem 并填写：
REM  任选一个 OpenAI 兼容视觉接口（OpenRouter/智谱/通义/本地 vLLM 等）
REM ============================================================
REM set VISION_API_URL=https://openrouter.ai/api/v1/chat/completions
REM set VISION_API_KEY=sk-请填写你的Key
REM set VISION_MODEL=moonshotai/kimi-latest
REM ============================================================

echo ═══════════════════════════════════════════
echo   水利工程质量安全合规管理助手 正在启动...
echo   提示：未配置视觉模型接口时，照片 AI 审核会提示"需配置 AI 接口"
echo ═══════════════════════════════════════════
node server.js
pause