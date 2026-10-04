# MHacks 人脉地图与 Spacetime 赛道研究

**文档类型：** Hackathon 功能需求与赛道研究
**适用范围：** Terry 负责的 Map；Spacetime sponsor track 的项目匹配与申报准备
**项目背景：** MHacks 现场 networking recruiter agent

## 1. 概要

项目希望减少活动中寻找合适交流对象所花的时间。Map 为参与者提供一个简单的场地视图，让用户知道附近哪些人选择开放交流；AI recruiter agent 根据参与者主动提供的信息寻找合适对象，并在双方确认后再交换身份信息。

本需求按当前决定将地图与 SpacetimeDB 实时状态直接集成，同时保留赛道申报研究作为独立交付：

1. **Map 功能：** 一个可分享的 2D 场地图，按区域显示选择加入的匿名参与者；SpacetimeDB 保存并实时同步 opt-in、区域变化和退出状态。
2. **Spacetime 赛道：** 说明实时共享点位如何服务核心 networking 场景，并整理申报内容与演示证据。

分工页另将 FREE-WILi 的 worth-it scoreboard 交给 Elena。Terry 的范围不包括该 scoreboard 或 FREE-WILi 硬件集成。

## 2. 问题、用户与目标

### 问题

大型 hackathon 中，参与者不容易快速找到技能、兴趣或当前需求相符的人。传统名单无法说明对方是否愿意交流，也不能在活动现场帮助参与者定位合适的交流机会。

### 主要用户

- **参与者：** 想发现附近愿意交流的人，同时保留是否展示自己的控制权。
- **项目演示者/评审：** 需要在短时间内看懂地图上的参与者、区域与 opt-in 状态，并验证关闭开关后点位会消失。

### 目标

- 用户能一眼看出场地区域及各区域内选择加入的人数/点位。
- 用户能自行控制是否出现在地图上。
- 地图不在双方同意前泄露参与者姓名或资料。
- Spacetime 赛道研究能解释该项目的实时状态需求为何适合 Spacetime，并明确什么证据能证明它不是附带集成。

### 非目标

- 3D 校园地图、摄像头手势或 GPS 级精确定位。
- 在地图内实现聊天、简历解析、匹配 agent 或双向同意流程本身。
- Terry 不负责 FREE-WILi scoreboard。
- 伪造参与人数、成功率、ROI 或实时集成结果。

## 3. Map 范围与用户流程

### 核心流程

1. 用户打开场地图，查看场地分区与选择加入的参与者点位。
2. 用户开启 **Open to meet / Show me on map**，选择或更新自己所在的场地区域。
3. 用户的点位出现在对应区域。点位只表达“此参与者选择在该区域展示”，不表示精确 GPS 坐标。
4. 用户关闭该开关后，自己的点位从其他参与者的地图视图中移除。
5. 如 recruiter agent 提议介绍，双方分别确认；双方都同意后，由 agent 流程交换身份或约定见面区域。Map 本身不负责揭示个人资料。

### 地图呈现

- 使用 2D 场地平面图或清楚标注区域的简化示意图。
- 每位可见参与者对应一个点；同一区域点位较多时，采用轻量错位或聚合避免完全重叠。
- 点位代表区域级位置，不呈现房间内的精确坐标。
- 在地图图例或首次提示中解释：点位仅来自用户主动选择加入的人；点位不是精确跟踪。
- 没有可用的主办方平面图时，使用标注清楚的示意图，并注明“不按比例”。不得伪称示意图是精确场地图。

### 最小数据接口

Map 使用 SpacetimeDB TypeScript/React 客户端订阅公开 presence 状态，并通过 reducer 写入自己的状态。公开 presence 只包含：

| 字段 | 用途 |
| --- | --- |
| `participantId` | 浏览器生成的随机匿名点位 ID；私有 owner 表将其绑定到 SpacetimeDB caller identity |
| `zoneId` | 参与者选择的场地区域 |
| `isDemoPersona` | 标识演示档案，防止将虚构人物当作真实用户 |

只有选择加入的参与者在公开 presence 表中有记录；退出 reducer 删除公开点位。地图呈现层不需要姓名、简历、联系方式或匹配理由。若产品其他流程需要这些资料，由 recruiter agent 在双方同意后处理。匿名 owner identity 只存在于默认私有的数据库表中。

### 演示数据

- 准备约 15 个合成档案，全部标记为 `demo persona`。
- 合成档案不得仿冒实际参与者，不使用未经同意的真实姓名、简历或联系方式。
- 演示时应能清楚区分合成点位与真实 opt-in 参与者；不能把合成数据计入真实 networking 或 ROI 数据。

## 4. 功能需求与验收标准

### MAP-1：显示场地与区域

**用户故事：** 作为活动参与者，我想在一张简单的场地图上看到各区域，以便知道人分布在哪里。

**验收标准：**

- 地图能显示所有配置的场地区域与图例。
- 当前区域数据能按 `zoneId` 放置参与者点位。
- 地图明确说明点位只代表区域，不代表精确 GPS 位置。
- 场地图资源不可用时，展示已标注的简化示意图或友好错误状态，不显示空白页面。

### MAP-2：参与者选择加入

**用户故事：** 作为参与者，我想控制自己是否出现在地图上，以便选择是否开放交流。

**验收标准：**

- 用户可以开启或关闭一个清楚命名的展示/交流开关。
- 开启后，该参与者的一个点位显示在所选区域。
- 关闭后，该参与者点位不再出现在地图数据结果中。
- 用户可更新区域，地图随数据更新移动该点位。
- UI 区分“当前状态已保存”与“更新失败”；失败时保留或恢复最后一次确认的状态。

### MAP-3：保护身份信息

**用户故事：** 作为参与者，我希望在尚未同意介绍前保持身份信息私密。

**验收标准：**

- 未完成双方同意时，地图不显示姓名、简历、联系方式或详细个人资料。
- 地图点位只包含渲染所需的最小状态。
- 是否交换身份由 recruiter agent 的双向同意流程决定，不能由点位点击绕过。

### MAP-4：演示状态

**用户故事：** 作为演示者，我希望用可重复的合成资料演示地图行为。

**验收标准：**

- 提供约 15 个标有 `demo persona` 的合成参与者。
- 演示者可展示开启、关闭、区域更新和无可见参与者等状态。
- 演示标签在地图或资料视图中可辨认。
- 所有报告数字能区分真实使用数据与演示数据。

## 5. Spacetime 赛道研究与项目匹配

### 赛道页面写明的内容

MHacks 的 [Tracks & Prizes 页面](https://safe-banon-80d.notion.site/Tracks-Prizes-3ed24ca0c81b80579aeff03edfa88af5)将该项目列为 **Best use of Spacetime**，列出的奖项是第一名 $1,000、第二名 $500、第三名 $200。页面鼓励把 Spacetime 用作核心实时后端，支撑共享状态、多人交互或用户、agent、系统之间的即时同步，并指出它必须在项目中有实际作用，不能只是附带加入。

该页面没有给出额外的强制 API 清单、必须使用的表结构或量化评分公式。文档中的建议不能误写成主办方硬性资格规则。

### 对本项目的匹配分析

Networking recruiter 的核心动作会改变多人共同关心的状态：谁愿意交流、某个介绍请求是否待确认、双方是否都接受、介绍是否完成。若团队选择用 Spacetime 承担这类共享状态和实时同步，它与赛道的方向匹配较强，因为 agent 的建议能触发实际状态变化，而不是只返回文本。

**建议的项目级 Spacetime 叙述（仅在演示确实实现后使用）：**

> SpacetimeDB powers the shared real-time state behind event networking. When a participant requests an introduction, the agent creates a shared request and each participant can respond. The request becomes an introduction only after both people agree, so every participant and agent sees the same current status.

这段话是申报草稿，不代表当前已完成实现。若团队没有用 Spacetime 承载真实共享状态，就不要在 Devpost 或演示中声称完成了该集成。

### 研究结论与实现边界

- **Map 与赛道研究职责分开：** Terry 的 MVP 会把 SpacetimeDB 用作地图 presence 的实时共享后端；申报研究与团队项目级介绍流程如何匹配赛道另行说明。
- **项目级匹配：** 团队可进一步评估将介绍请求、双方响应和见面状态也作为 Spacetime 实时共享状态；这不是 Terry 地图 MVP 的前置条件。
- **强证据：** 若团队完成 Spacetime 集成，演示应显示两名参与者或 agent 对同一个请求作出响应，双方客户端看到状态同步，且只有双方同意后流程才进入“已介绍”。
- **弱证据：** 仅展示数据库连接成功、静态截图、预填记录，或只把 Spacetime 当作与核心流程无关的存储，不能有力证明其在项目中的意义。

SpacetimeDB 官方 TypeScript 文档说明客户端可订阅数据库查询并接收实时行变化；官方 React 集成提供 `useTable` 等订阅 hook 与 `useReducer` 写入接口。它们是团队未来采用 Spacetime 时的技术参考，不是 sponsor track 页面额外规定的提交条件：[TypeScript/React API](https://spacetimedb.com/docs/clients/typescript/)、[React Quickstart](https://spacetimedb.com/docs/quickstarts/react/)。

## 6. 赛道申报与演示清单

- 在官方赛道页核对当前标题和奖项，再在 MHacks 的 Devpost submission 中选择 **Best use of Spacetime**（以提交表单实际提供的选项为准）。
- 用一两句话说明 Spacetime 具体承载什么共享状态、谁会读写这些状态，以及实时同步为用户解决了什么问题。
- 演示至少两个参与者客户端：创建介绍请求、分别回应、实时观察状态变化、确认只有双方同意才完成介绍。
- 在界面或演示中明确指出 Spacetime 所承载的状态与关键调用；避免只口头宣称使用。
- README 写明真实运行步骤、Spacetime 模块/部署方式，以及哪些功能依赖有效网络或服务配置。
- 提交前确认演示使用真实运行流程；截图、视频与功能描述一致；不得把 mock 或 demo persona 说成生产数据。
- 按团队 pitch 与分工页，Devpost 和 demo 视频由其他组员负责；Terry 提供地图说明及 Spacetime 赛道研究材料，不单独替团队提交整个项目。

## 7. 依赖、风险与推进顺序

| 阶段 | 工作 | 完成条件 |
| --- | --- | --- |
| 1. 配置场地与云端 | 确认场地区域；拿不到主办方平面图时采用示意图；发布 SpacetimeDB 模块 | 模块发布成功；六个示意区域与数据区域 ID 一一对应 |
| 2. 搭建 2D 视图 | 展示场地、区域、图例和参与者点位 | 使用 15 个带明确标记的合成 persona 能完整演示 |
| 3. 接入实时交互 | 展示/交流开关通过 reducer 写入；区域更新推送给所有订阅客户端 | 两个浏览器能看到加入、移动和移除的实时变化；身份仍隐藏 |
| 4. 完成赛道调研 | 与团队核实 Spacetime 是否真实承载共享状态；整理申报描述和演示脚本 | 每项赛道主张都有可运行功能或明确标注为建议 |
| 5. 联调与冻结 | 与 agent/Photon/scoreboard 负责者确认 participant ID、区域和 consent 边界；在最终提交截止前演练 | 点位含义、同意流程和 sponsor 说明一致；冻结版本可重复演示 |

### 主要风险

- **场地数据不完整：** 原始 pitch 只写区域示例，没有附实际场地图。拿不到主办方平面图时，使用标注为示意图的区域图。
- **真实参与者数量少：** 用清楚标识的 demo persona 演示 UI；不要因此推断产品 ROI 或真实匹配成效。
- **身份或位置暴露：** 只展示区域级参与者点；移除展示后立即从结果中隐藏；身份交换仍由双向同意保护。
- **赛道主张超过实现：** 赛道页描述的是希望看到的项目形态。最终申报只写团队实际完成、能现场展示的 Spacetime 功能。
- **前端与数据库分别部署：** SpacetimeDB 承载实时状态，React 前端部署到 Vercel；两端需配置同一个数据库名称和公开连接 URI。

## 8. 验收清单

- [ ] 2D 场地图展示已配置区域，且不伪装为 GPS 级定位。
- [ ] 每位选择加入者对应一个可见点；退出后点位消失。
- [ ] 区域更新反映到地图；更新失败有明确状态。
- [ ] 未经双方同意，地图不泄露身份资料。
- [ ] 演示档案约 15 个，且全部清楚标注 `demo persona`。
- [ ] Map 通过 SpacetimeDB reducer 写入 presence，并通过订阅获得实时更新。
- [ ] Spacetime 研究明确区分赛道原文、项目匹配建议与已完成实现。
- [ ] Devpost 描述与现场演示一致；只申报可验证的 Spacetime 用法。

## 9. 参考资料

- [MHacks 项目 Google Doc](https://docs.google.com/document/d/1j6E8iL5e5pLBmPc833PqSNDB765dd8qANaYzNUgV7Lk/edit)（pitch 与团队分工）
- [MHacks Tracks & Prizes](https://safe-banon-80d.notion.site/Tracks-Prizes-3ed24ca0c81b80579aeff03edfa88af5)（赛道原始说明）
- [MHacks 2026 Live Timeline](https://www.mhacks.org/live)（活动日期与最新日程；日程可能变更）
- [SpacetimeDB TypeScript Reference](https://spacetimedb.com/docs/clients/typescript/)（客户端、订阅、reducers 与 React hooks）
- [SpacetimeDB React Quickstart](https://spacetimedb.com/docs/quickstarts/react/)（官方 React 项目结构与模块示例）
