# dsh-daily-ticker (每日脉搏)

## 概述
本项目是 dsh（DeepSeek Harness）下的「每日脉搏」插件，暴露在 README 以服从资料管理工具的格式要求。其核心职责是面向 GitHub 就绪的项目（Workspaces）采集每日零售资讯与推荐条目（含AI从业/开源/学术），生成并落地当日 Markdown 日报，支撑自动订阅与索引。

典型工具调用方式详见资管工具定义：
- `daily_brief`: 获取当日推荐条目（按主题分组，含标题、来源、时间、热度、推荐理由与条目 id）
- `daily_refresh`: 立即抓取所有源并重排日报
- `daily_sources`: 查看采集源清单与最近一轮运行状态
- `daily_search/rewind`: 在近数日日报索引中检索条目

可用主题：
- 全部主题（留空）
- AI
- 开源
- 学术

## 快速开始

### 1) 添加/管理订阅源
```bash
# 校验与添加一个 RSS/Atom 订阅
dsh-rss check https://example.com/rss.xml
dsh-rss add https://example.com/rss.xml —name "示例源" —category AI
```

### 2) 导入/导出订阅列表
```bash
# 导出订阅 OPML
dsh-rss opml export

# 从 OPML 批量导入
dsh-rss opml import opml.txt
```

### 3) 抓取与查看日报
```bash
# 立即刷新抓取（全网需数分钟）
dsh-daily refresh

# 仅获取当日推荐条目（按主题）
dsh-daily brief --topic AI

# 在历史日报索引中检索
dsh-daily search "Transformer 论文" --days 30
```

### 4) 日报归档管理
```bash
# 查看归档磁盘占用与压缩/删除预览
dsh-daily prune

# 对旧归档执行压缩/删除（仅当 apply=true 时动盘）
dsh-daily prune --apply
```

## 工作区与偏好
- 每个项目会独立维护主题偏好与索引反馈，确保 A 项目调整「多推 Rust」不会污染 B 项目。
- 可通过命令行指令调整推荐偏好（写到 ~/.dsh/daily/prefs.json，即时对当日条目重新排序）。

## 集成实践
- 工作区启效：插件会从当前会话/工作区推断项目，自动跟随。
- 禁用自动跟随：`dsh-daily project use ~/.some/other/project/.git`
- 恢复自动跟随：`dsh-daily project follow`

## 技术栈与依赖
- 仅保持极简的本地执行形态；具体版本与本地路径以获取到的 `load_workspace_dependencies` 为准。

## License
MIT License用于归档；本 README 仅作信息聚合与参考。

---

> 由 dsh（DeepSeek Harness）提供；每日脉搏项目请根据你的配置管理实际订阅与落地规则。