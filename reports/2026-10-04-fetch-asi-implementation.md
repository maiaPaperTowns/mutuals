# mutuals Fetch.ai 方案一实施记录

## 已实现并上线

- 网站 `/events` 增加 **Use mutuals in ASI:One**：生成五分钟一次性码、查看连接、撤销连接。
- 后端保存私有授权码、会话授权和独立 ACP 服务白名单。授权最长 24 小时，每个网站账号只能保留一个有效会话；新绑定替换旧绑定。服务不接收用户 ID，不冒充 Clerk。
- Python/uAgents 实现签名 ACP、消息确认、sender/session 哈希及稳定 request ID。用户已选择 Agentverse Hosted，代码已保存、启动并发布协议；无需本机进程或本地网络权限。
- Hosted Agent 通过 HTTPS 调用现有 Maincloud 的原生授权和业务 procedures。两个同意测试的 ASI 账号通过真实路由隔离验证后，用户批准创建独立服务身份并配置 Agent Secrets，私人访问已开启；每段聊天仍需网站一次性授权。删除本次实现中已被替代的本机桥接和启动脚本。
- ASI Pre/Post 调用网站同一套原生业务逻辑。Pre 可保存收藏，Post 可向内部 Pre/During 查询并保存私人草稿。During 返回网站 GPS 链接，原有定位和连接规则没有更改。
- 模型调用后重新检查授权、活动阶段和原始授权代次；撤销或改绑账号时，不再返回旧账号结果或执行旧工具决定。
- [公共源码](https://github.com/maiaPaperTowns/mutuals) 已包含对应实现、运行说明、Agent 名称/地址及两个提交 badge。只移植本次实现，保留公共仓库已有的独立修改。

## 实际验证

| 验证 | 结果 |
| --- | --- |
| Python 完整测试 | 166 passed |
| 原生模块/网关测试 | 58 passed |
| 网站测试 | 29 passed |
| TypeScript 检查、网站构建、原生模块构建与 bindings | 通过 |
| 隔离的真实 SpacetimeDB + SDK + Hosted 使用的 HTTP call 路由 | 通过；外部模型/向量响应为合成 fixture |
| 线上网站 | 生成、显示、撤销测试绑定码通过；后续用户批准的本人账号已成功绑定 ASI 聊天 |
| Maincloud live provider probe | ASI 与 Pinecone write/fetch/query/cleanup 通过 |
| 数据保留 | 11 个地图资料、9 个私人资料和 9 个资料向量均保留 |
| 原始授权改绑竞态 | 审查复现后修复，同账号和跨账号改绑回归均通过 |
| Hosted -> ASI:One 实际消息 | 两个同意测试的账号有不同签名 sender/session hash；各自同聊天连续消息 hash 稳定，新聊天 hash 不同 |
| ACP 文本命令 | 实际 ASI 文本包含接收者 mention；新增回归并修复前缀解析，实际 link/events 成功 |
| 私人会话隔离 | 本人绑定聊天可查询演示活动，另一个未绑定聊天仍要求授权，不返回活动数据 |
| 真实 Pre 工作流 | 读取真实推荐、解释匹配、保存收藏均在 ASI 完成；刷新网站后星标保持选中，聊天历史同步 |

实际 SDK 联调也覆盖绑定码重复消息兑换、无授权会话、Pre 消息重试、Post recap 重试、网站撤销、聊天解绑及 During 跳转。单元测试另覆盖有效期、工具范围和模型处理中撤销。

网站和原生模块基础实现：私有 `mhacks-2026/main` 的 `c2a5874`；公共 `mutuals/main` 的 `fcce9d8`。Hosted 改造：私有 `c8be7b5`、公共 `fa55bf1`；命令前缀修复：私有 `76e62d1`、公共 `a9ee0f2`，均核对远端 SHA，保留公共仓库队友的独立提交。最终审查未留下 Important/Critical 问题。

Vercel 部署 `dpl_2Yo6yZ45iukTiEaSqqwNZCQ62PZ9` 为 **READY**，入口 https://mutuals.tech/events 。Maincloud 使用 `--delete-data=never` 发布，只增加三个私有 ASI 表。

## 实际 Agent 与演示

实际 Hosted Agent：**mutuals Networking**，handle **@mutuals-mhacks2026**，地址：

`agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2`

[Agentverse profile](https://agentverse.ai/agents/details/agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2/profile) 已保存名称、介绍、README、两个 badge 和三条 starter prompts，公开 AgentChatProtocol v0.3.0。保存后重新载入编辑器、复制完整文本，确认与 `agents/hosted/agent.py` 一致，再启动。日志确认 Successfully started agent 和 Almanac 注册；页面显示 **Active / ASI Available / Hosted**。

[ASI:One 页面](https://asi1.ai/ai/agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2) 显示实际 Agent 名称、handle 和介绍。两个同意参与的账号完成 public probe；同账号另一个聊天也有不同 hash。离线测试和真实原生 SDK/HTTP 集成覆盖消息幂等，未人为触发真实 ASI 平台重发，不将它声称为已实测平台重试。旧 Mailbox 探测进程已停止，本机权限问题不再是部署依赖。

用户明确批准创建并配置专用凭据、绑定并实测自己的账号。`asi_chat_service` 已配置一个独立身份，Hosted Agent Secrets 已保存专用 token 和 `ASI_CHAT_ENABLED=true`。真实网站绑定成功，网站显示 ASI:One connected。未绑定聊天查询 events 仍被拒绝；不把 ASI 身份直接当成网站身份。

用户随后批准发布独立演示活动并选择先做 Pre。活动 **mutuals Fetch Hosted demo**，ID `6897a464-75b2-40d3-8dc0-d0c698d0b272`，地点 MHacks integration demo，时间 2026-10-04 09:00。本人和一位同意测试的队友加入后，仅锁定这个活动的两人名单，真实准备推荐。原有两场 MHacks 活动没有修改。

已实测的 ASI 流程：`events` 列出本人活动 -> 询问应见哪位参与者及理由 -> Agent 从真实列表给出推荐 -> 用户请求收藏 -> Agent 确认收藏。刷新网站后收藏 checkbox 为选中，两个业务回合出现在同账号的 Pre 历史。完成动作不需要 GPS，也不需要用户回网站手动点收藏；网站仅用于核对持久化。截图保存在本机 ignored reports：`asi-pre-favorite-reply.jpg`、`asi-pre-favorite-persisted.jpg`，不上传私人聊天截图到公共仓库。

## 剩余提交材料

1. 用户要求保留当前测试聊天，不删除授权消息。保留私人记录；尚未创建或公开这段聊天的 Shared Chat，不能将其写成已完成。
2. 录制并上传 3-5 分钟真实演示视频。可用已通过的 Pre 流程；不需要为提交额外伪造 GPS 或 Post 连接。
3. Devpost 提交；Team Lead 在 MHacks Submission Agent 中填写真实资料、仓库和演示链接；其他队员自行用 Team ID 加入，核对 **Submitted**。

Post 代码、角色咨询与私人草稿有离线及原生集成验证；这个独立活动没有真实完成的连接，所以未声称完成线上 Post 草稿演示。Pre 已展示实际工具执行和保存，可作为主工作流证据。

工程部署和真实 Pre 验证已完成，实际竞赛提交尚未完成。表单 optional 字段与 sponsor 必须有可工作的 Agent 是两层要求。完整运行、演示与提交操作见 [FETCH_SUBMISSION.md](../docs/FETCH_SUBMISSION.md)，官方要求见 [MHacks Hackpack](https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack)。
