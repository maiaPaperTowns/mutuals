# mutuals Fetch.ai 方案一实施记录

## 已实现并上线

- 网站 `/events` 增加 **Use mutuals in ASI:One**：生成五分钟一次性码、查看连接、撤销连接。
- 后端保存私有授权码、会话授权和独立 ACP 服务白名单。授权最长 24 小时，每个网站账号只能保留一个有效会话；新绑定替换旧绑定。服务不接收用户 ID，不冒充 Clerk。
- Python/uAgents 实现签名 ACP、消息确认、sender/session 哈希及稳定 request ID。用户已选择 Agentverse Hosted，代码已保存、启动并发布协议；无需本机进程或本地网络权限。
- Hosted Agent 通过 HTTPS 调用现有 Maincloud 的原生授权和业务 procedures。独立服务 token 使用 Agent Secrets；私人访问默认关闭，待真实 ASI 会话隔离验证后配置。删除本次实现中已被替代的本机桥接和启动脚本。
- ASI Pre/Post 调用网站同一套原生业务逻辑。Pre 可保存收藏，Post 可向内部 Pre/During 查询并保存私人草稿。During 返回网站 GPS 链接，原有定位和连接规则没有更改。
- 模型调用后重新检查授权、活动阶段和原始授权代次；撤销或改绑账号时，不再返回旧账号结果或执行旧工具决定。
- [公共源码](https://github.com/maiaPaperTowns/mutuals) 已包含对应实现、运行说明、Agent 名称/地址及两个提交 badge。只移植本次实现，保留公共仓库已有的独立修改。

## 实际验证

| 验证 | 结果 |
| --- | --- |
| Python 完整测试 | 164 passed |
| 原生模块/网关测试 | 58 passed |
| 网站测试 | 29 passed |
| TypeScript 检查、网站构建、原生模块构建与 bindings | 通过 |
| 隔离的真实 SpacetimeDB + SDK + Hosted 使用的 HTTP call 路由 | 通过；外部模型/向量响应为合成 fixture |
| 线上网站 | 已实际生成、显示、撤销测试绑定码；无保留的测试授权码 |
| Maincloud live provider probe | ASI 与 Pinecone write/fetch/query/cleanup 通过 |
| 数据保留 | 11 个地图资料、9 个私人资料和 9 个资料向量均保留 |
| 原始授权改绑竞态 | 审查复现后修复，同账号和跨账号改绑回归均通过 |

实际 SDK 联调也覆盖绑定码重复消息兑换、无授权会话、Pre 消息重试、Post recap 重试、网站撤销、聊天解绑及 During 跳转。单元测试另覆盖有效期、工具范围和模型处理中撤销。

网站和原生模块基础实现：私有 `mhacks-2026/main` 的 `c2a5874`；公共 `mutuals/main` 的 `fcce9d8`。Hosted 变更随后单独同步；以 Git 历史中的 `feat(agents): run ASI entry point on Agentverse Hosted` 为准。

Vercel 部署 `dpl_2Yo6yZ45iukTiEaSqqwNZCQ62PZ9` 为 **READY**，入口 https://mutuals.tech/events 。Maincloud 使用 `--delete-data=never` 发布，只增加三个私有 ASI 表。

## 尚未完成的外部步骤

实际 Hosted Agent：**mutuals Networking**，handle **@mutuals-mhacks2026**，地址：

`agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2`

[Agentverse profile](https://agentverse.ai/agents/details/agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2/profile) 已保存名称、介绍、README、两个 badge 和三条 starter prompts，公开 AgentChatProtocol v0.3.0。保存后重新载入编辑器、复制完整文本，确认与 `agents/hosted/agent.py` 一致，再启动。日志确认 Successfully started agent 和 Almanac 注册；页面显示 **Active / ASI Available / Hosted**。

[ASI:One 页面](https://asi1.ai/ai/agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2) 已显示实际 Agent 名称、handle 和介绍。**公开页面和 ASI Available 不等于完成真实聊天/私人业务演示。** 当前 Edge 尚未登录 ASI:One；已打开登录页面请用户完成。旧 Mailbox 探测进程已停止，本机权限问题不再是部署依赖。

因此目前 `asi_chat_service` 仍为空，Hosted private access 关闭。还不能在 ASI:One 中兑换真实网站授权码或执行私人 Pre/Post 工作流。按批准方案，必须先用两个同意参与测试的 ASI 账号验证 sender/session 隔离，然后才配置独立服务 token 和开启私人访问。

下一步依次完成：

1. 用户登录 ASI:One；同意参与的第二个账号协助路由测试。
2. ASI:One 两账号/两会话路由验证，确认会话间隔离和同会话连续性。
3. 配置独立服务身份和 Hosted Agent Secrets，开启私人后端。网站生成码 -> ASI 绑定 -> Pre 收藏/Post 回顾与保存草稿 -> 网站核对持久化。
4. 用同意公开的合成演示资料创建真正成功的 Shared Chat，录制 3-5 分钟视频。
5. Devpost 提交；Team Lead 在 MHacks Submission Agent 中填写真实资料、仓库和演示链接；其他队员自行用 Team ID 加入，核对 **Submitted**。

这部分未完成，因此不能声称已完成 Fetch.ai sponsor submission。表单 optional 字段与 sponsor 必须有可工作的 Agent 是两层要求。完整运行、演示与提交操作见 [FETCH_SUBMISSION.md](../docs/FETCH_SUBMISSION.md)，官方要求见 [MHacks Hackpack](https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack)。
