# 1688-hanhong-main - Session Context

![Continuity](https://raw.githubusercontent.com/hackerware/continuity/main/assets/icon.png)

## Cross-LLM Resumption
To resume this session in ANY AI tool:
1. Read this file for project context
2. Read `.continuity/SESSION_NOTES.md` for goals/blockers/next steps
3. Read `.continuity/unfinished-task.json` for structured resume state
4. Call `get_quick_context` if MCP is available

## AI Assistant: Engineering Guardrails

**Honesty:** State facts only if certain. Label suggestions with confidence level. Label speculation explicitly.

**Decision Logging:** Log decisions that change structure, behavior, or long-term direction immediately after the change. If you're unsure whether something qualifies, say so explicitly and follow the project instructions.

**MCP Availability:** Client capabilities differ. If Continuity MCP tools are available, use them first. If not, fall back to the repo instruction files and session notes instead of assuming memory is connected.

**Workspace Self-Test:** Check `.continuity/mcp-health.json` or resource `continuity://mcp-health` for the latest workspace-target probe. This is about the workspace MCP target, not proof that the current chat client has mounted Continuity.

**Search First:** Before proposing architectural changes, call `search_decisions(query: "keyword")` to check for prior decisions.

**Recovery:** If you realize earlier decisions were not logged, pause, summarize, log retroactively, and inform the user.

**Transparency:** Inform the user when you log decisions, recover missed decisions, detect drift, or find conflicts with past decisions.

**When MCP is connected, richer guardrails are available via resource `continuity://session-handoff`.**

---

## 🏗️ Architecture Overview

**Core Systems:**
- **Decision Logging** - Smart clipboard detection, 5 templates, auto-tag extraction
- **Documentation Tracking** - AST parsing with TypeScript compiler API, semantic change detection
- **File Protection** - Prevent AI modification of critical files (.env, credentials)
- **MCP Integration** - Works with Claude Code, Codex, Cursor, Copilot, Gemini, Cline/Roo, and other MCP-capable clients
- **Delta Tracking** - Shows what changed since last sync
- **Auto-Sync** - Hands-free workflow automation

**Technical Depth:**
- TypeScript Compiler API (ts.createSourceFile, ts.SyntaxKind) for AST parsing
- Exports: functions, classes, interfaces, types, constants
- Tracks: signatures, async status, parameters, return types, JSDoc
- Change detection: new/removed exports, signature changes, async conversions
- Markdown parsing: code blocks, inline code, file references
- Gitignore pattern matching with glob-to-regex conversion
- Smart .txt filtering (docs/, notes/, guides/ folders only)

**Storage:**
- `.continuity/decisions.json` - Architectural decisions
- `.continuity/doc-status.json` - Documentation status
- `.continuity/doc-exports.json` - Code exports snapshot
- `.continuity/delta-snapshot.json` - Last sync state
- `.continuity/protected-files.json` - Protected file patterns
- `SESSION_HANDOFF.md` - Full context for AI handoff


## Project Purpose
> 阿里巴巴 1688 店铺实时数据看板，支持 GitHub Pages 部署，只需更新 `data.xlsx` 即可刷新数据。 --- 点击右上角 **Fork**，克隆到你自己的账号。 仓库 → Settings → Pages → Source 选择 `main` 分支 / `/ (root)` 目录 → Save。 稍等 1~2 分钟后访问：`https://<你的用户名>.github.io/<仓库名>/` 将 **`data.xlsx`** 上传到仓库根目录，刷新页面即可。 --- | 列名（任选其一均可识别）| 说明 | |---|---| | 日期 / date | 格式：2025-01-01 或 Excel 日期格式 | | 总展现 / 展现量 / 曝光量 | 当日展现总数 | | 广告展现 / 广告曝光 | 广告展现数 | | 自然展现 / 自然曝光 | 自然展现数 | | 访客 / 访客数 | 当日访客数 | | 询盘 / 询盘数 / 商机 | 当日询盘数 | | 接待 / 接待数 / 接待人数 | 接待对话数 | | 广告花费 / 消耗 / 推广花费 | 当日广告消耗（元）|

## 🎯 Currently Working On (Last 30 min)
- js\data-pipeline.js
- api\sample-dashboard.json
- config.json
- README.md
- js\dashboard.js
- index.html

## Recent Changes
**Branch:** main

**Modified:**
- README.md
- index.html

**Untracked:**
- .cursorrules
- .github/copilot-instructions.md
- .gitignore
- AGENTS.md
- CLAUDE.md
- GEMINI.md
- api/sample-dashboard.json
- config.json
- js/dashboard.js
- js/data-pipeline.js
- workers/xlsx-worker.js


## Recent Commits
- `40f538e` 优化数据看板：增加周月年汇总下载、新增4个核心指标、接待趋势图表、支持PDF导出和A4打印 (libebe868-hash)


## Project Structure
.continuity/
404.html
AGENTS.md
CLAUDE.md
GEMINI.md
README.md
SESSION_HANDOFF.md
api/
config.json
data.xlsx
index.html
js/
workers/

---

## Session Checklist

- [x] Read SESSION_HANDOFF.md
- [ ] Verify whether Continuity MCP tools are available in this client
- [ ] If MCP is unavailable, use repo instruction files, `.continuity/mcp-health.json`, and `.continuity/unfinished-task.json` as fallback context
- [ ] Search past decisions before proposing architectural changes
- [ ] Log architectural decisions (only structural/behavioral/directional changes)
- [ ] Inform user when decisions are logged, recovered, or conflicts detected
- [ ] Recover any missed decisions before session ends

---
Generated: 2026-05-15T02:15:18.781Z
