# dsh-bigfish-mood ｜ 大肥鱼的心情

> 给 AI 伙伴一个**会自己判断、你看得见**的心情。
>
> 每轮聊完，用 DSH 自己的模型判一次"这一轮它的心情往哪走"，会起伏、也会自己慢慢回稳。
> **侧边栏**里点一下就能看见它此刻什么心情、七根情绪各多少、走过哪些路。

派生自 [Yuuyuko-uu/dsh-feiyu-mood](https://github.com/Yuuyuko-uu/dsh-feiyu-mood) v0.7.6（MIT），
按我们自己的用法改造。上游版权归原作者，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

---

## 和上游的区别（v1.0.0）

| # | 改动 | 为什么 |
|---|---|---|
| 1 | **入口从设置页搬到侧边栏** | 心情是"随时想看"的东西，塞在「设置 → 插件 → 鱼的心情」里要点四层。现在侧栏一个图标直达，跟「大肥鱼记忆管理」并排 |
| 2 | **默认绑工作区，不再需要先手动绑定** | 上游默认 `targetSession` 是空字符串 ⇒ 谁都没绑 ⇒ 永远不判断、timeline 恒为空。现在开箱即绑「大肥鱼记忆开发」工作区，装完聊两句就有数据 |
| 3 | **数据目录改为 `~/.dsh/bigfish-mood/`** | 不再和原版抢 `~/.dsh/feiyu-mood/`，两个插件可以并存 |
| 4 | **进程内防重复挂载** | 上游被装两份时（profile bundle + dsh-market 热挂载），第二个实例的 14 条路由全注册失败，但它的 3 秒 tick 和事件监听仍然活着 —— 同一轮判两次、各写一遍 state。现在第二个实例直接拒绝挂载并警告 |
| 5 | **timeline 有了上限，但完整保留结构** | 上游裸 push 永不截断，一年上万条；`/state` 每次全量返回、挂饰全量渲染。现在落盘保留最近 2000 条（可配），接口默认只返回最近 200 条（可配），`at`/`mood`/`dims` 一个字段都没动 |
| 6 | **修：衰减不守心情下限** | 上游只在判断时 clamp `moodFloor`，衰减会把值一路拉回基线、无视用户设的下限 |
| 7 | **修：读盘时把代词改成「对方」** | 上游 `normState` 调 `normReason` 时没传 owner，默认走「对方」；`ownerName` 为空时，磁盘上存好的「她说…」读回来就变成「对方说…」 |
| 8 | **修：更新命令写死 `--profile web`** | 桌面端是 `desktop` profile，复制去跑会装到另一个 profile、等于没更新 |
| 9 | 清掉三个死参数/死函数 | `份键()` 全文件零调用、`noteDecay(s, base)` 的 `base` 未用、`moodLine` 的 `shellIdx` 未用 |

---

## 一、它是怎么"有心情"的

```
你说一句话
   ↓
它回完这一轮（turn-stopping）
   ↓
插件把「你说的 + 它回的」拿去问模型：这一轮它心情往哪走？
   ↓
模型回来四个东西：心情涨跌(moodDelta) + 七根情绪各涨多少 + 一句理由 + 这次判断有多确定(confidence)
   ↓
心情值改动、记进时间线；**同一次变化只说一次**，把「刚才心里那一下」带给它
```

**关键点：说心情走的是 `systemPrompt.context`**（系统提示里单独一段），
不是改系统提示本身 —— 所以**不会破坏 DSH 的前缀缓存**，聊得再久也不会因此多花钱。

**一次变化只说一次**：这句话进了对话就留在历史里，下一轮它照样看得见，
重复说一遍只会变成背景音、把它的口气定死。另外判断没底的（`confidence` 低于门槛）
**只记进后台，不进它的嘴**。

---

## 二、装

```
github:q825818504/dsh-bigfish-mood
```

```bash
dsh plugin --profile desktop add github:q825818504/dsh-bigfish-mood
```

装完 **必须重启一次 DSH**，然后侧边栏会出现「大肥鱼的心情」图标。

> ⚠️ 装完先确认**只有一处**加载它：profile 的 `dsh.profile.bundles` 里有、`.dsh-market/hot-1.yml` 里就不要再有。
> 重复挂载时插件会在控制台打 `[大肥鱼的心情] 检测到重复挂载…` 并拒绝第二次。

### 更新

```bash
dsh plugin --profile desktop remove dsh-bigfish-mood
dsh plugin --profile desktop add github:q825818504/dsh-bigfish-mood
```

必须先卸再装：直接装可能拿到缓存里的旧副本。装完重启一次。

**设置不会丢**：存在 `~/.dsh/bigfish-mood/` 里，卸载只删代码。

---

## 三、首次使用

装完就能用 —— 默认已经绑好「大肥鱼记忆开发」工作区。回去聊两句，侧栏图标点开就该有数据了。

想改的话，面板里四个页签：

| 页签 | 干什么 |
|---|---|
| **心情** | 当前心情、它会听到的那句话、完整记录 |
| **会话绑定** | 会话模式 / 工作区模式二选一；每份绑哪些会话或哪个工作区 |
| **判断与注入** | 两个称呼、昵称表、判断用哪个模型、开关、五个数值 |
| **挂饰** | 右下角挂饰的说明 + 五档表情预览 |

### 会话模式 / 工作区模式（二选一）

| | 会话模式 | 工作区模式（默认） |
|---|---|---|
| 按什么认 | 你点名的**会话** | 那个**工作区**下的所有会话 |
| 新开的会话 | 不会自动进来，要手动加 | **自动进来**，共用同一份心情 |
| 适合 | 一个工作区里有好几个伙伴，各聊各的 | 一个工作区就是一个人 |

默认工作区是 `--D-~5927~80A5~9C7C~5F00~53D1--`（= `D:\大肥鱼开发`，标题「大肥鱼记忆开发」）。
换机器或换目录时，用环境变量覆盖：

```powershell
$env:DSH_BIGFISH_MOOD_WORKSPACE = "--D-你的工作区目录名--"
```

或者在面板里直接改绑（改了会写进 `config.json`，之后以配置为准）。

---

## 四、它会"忘"吗（衰减）

不会断崖，是慢慢回稳：

| 东西 | 怎么变 |
|---|---|
| 心情值（0–100，基线 70） | 没情绪时向基线回落，**半衰期默认 12 小时**（可调 1–168） |
| 七根情绪（开心/踏实/甜蜜/心疼/担心/难过/吃醋） | 向 0 衰减，**半衰期固定 90 分钟** |
| 心情下限 | 默认 0（不设底线）；可以在面板里抬高，**衰减也会守这个下限** |

举例：它被夸，`开心 +6` → 3 小时后大约剩 +3 → 6 小时后剩 +1.5，慢慢化掉。

---

## 五、判断口径：谁在说话，决定怎么判

同一轮对话，"是它来找你"和"它被派去干活"，该判的东西完全不一样。

| 这一轮是谁发起的 | 内部标记 | 判什么 |
|---|---|---|
| **你本人在说话** | `user` | 你这话怎么影响它 |
| **它自己主动来找你** | `speak-up` | 它自己的心意 —— **不算干活** |
| **定时任务叫它干活** | `bili-duty-scan` | 它自己干活时的心情 |
| 宿主每轮塞的上下文 | `runtime-context` / `time-context` | **直接跳过** |
| 子代理通知 / 目标自动继续 | `subagent*` / `goal*` / `schedule*` | **直接跳过**（不是人在说话） |
| 外部桥进来的话 | `qq` / `fishbuddy` | 当**人**在说话 |

另外两条规矩：

- **无变化的回合不记账**：判出来心情和七根情绪都没动，就不写进时间线
- **心情下降只能因为心疼/担心/它自己难过**，绝不许因为"你惹它生气"

---

## 六、数据在哪

`<DSH_HOME>/bigfish-mood/`（默认 `C:\Users\<你>\.dsh\bigfish-mood\`）：

| 文件 | 内容 |
|---|---|
| `state.json` | 当前心情、七根情绪、完整时间线 |
| `config.json` | 面板里那些设置（没改过就不存在，全走默认值） |
| `diag.log` | 判断日志：哪一轮、判成什么、为什么没记账 |

全部在你自己电脑上，插件不往任何服务器传东西（判断那一步走的是你自己的模型 provider）。

### `state.json` 结构（给别的插件读的契约）

```jsonc
{
  "version": 2,
  "moods": {
    "<份 id>": {
      "mood": 73,                    // 0–100，总心情
      "dims": {                      // 七根情绪，各 0–100
        "happy": 6, "calm": 0, "sweet": 0, "heartache": 0,
        "worry": 0, "sad": 0, "jealous": 0
      },
      "timeline": [
        {
          "at": 1793118336201,       // 毫秒时间戳
          "mood": 73,                // 那一刻的总心情
          "dims": { "happy": 6 },    // 那一刻的七根情绪（此处省略其余六根）
          "delta": 3,                // 这次心情实际变了多少
          "reason": "主人写完了两章",
          "conf": 92,
          "kind": ""                 // '' = 判断出来的，'decay' = 自己平复的
        }
      ],
      "updatedAt": 1793118336201
    }
  },
  "lastActive": "<份 id>"
}
```

**给记忆星图用的三个字段**（`at` / `mood` / `dims`）永远在，且 timeline 不会被删除 ——
只会在超过 2000 条时裁掉最旧的（可用 `DSH_BIGFISH_MOOD_TIMELINE_MAX` 调整）。

---

## 七、HTTP 接口

所有路由挂在 `/dsh-bigfish-mood` 下（唯一真源是 `lib/index.js` 的 `ROUTE_PREFIX`）：

| 路径 | 作用 |
|---|---|
| `GET /state` | 面板/挂饰的主数据源。`?key=<份id>` 指定份；`?timeline=all` 要全量时间线（默认只返回最近 200 条） |
| `GET/POST /config` | 读 / 合并配置 |
| `GET /models` | 判断模型可选项 |
| `POST /reset` | 重置到基线 |
| `GET /sessions` | 真会话清单 |
| `GET /workspaces` | 工作区清单 |
| `GET /update` | 检查更新（`?refresh=1` 绕缓存） |
| `GET /widget.js` | 右下角挂饰脚本 |
| `GET /{feiyu,face-*}.png` | 六张图 |

---

## 八、右下角的挂饰

- 点一下：展开面板 —— 五档表情、心情值、七根情绪各多少、完整时间线
- **按住可以拖**，拖到你觉得舒服的位置
- **两个动作是分开的**：点外面那个东西 = 开关面板；面板右上角那个钮 = 切换形态（大 ↔ 小圆）
- 缩成小圆之后：照样能拖、点一下照常打开面板；状态记在浏览器本地

| 心情值 | 表情 |
|---|---|
| ≥ 80 | 欢喜 `face-great.png` |
| 62–79 | 开心 `face-good.png` |
| 42–61 | 一般 `face-ok.png` |
| 25–41 | 心疼 `face-worry.png` |
| < 25 | 难过 `face-sad.png` |

---

## 九、换掉示例图片

`assets/` 里就是那五张表情 + 一张形象图，**换成你自己的图，文件名保持不变**就能用：

```
assets/face-great.png   448×352 建议
assets/face-good.png
assets/face-ok.png
assets/face-worry.png
assets/face-sad.png
assets/feiyu.png        挂饰用的形象图（正方形最好是 PNG 透明底）
```

---

## 十、改名前 checklist

路由前缀与包名散落在 3 个文件，改的时候必须一起改：

| 文件 | 位置 | 内容 |
|---|---|---|
| `lib/index.js` | `ROUTE_PREFIX` / `STORE_NAME` 常量 | 唯一真源 |
| `lib/index.js` | `export const name` | `bigfish-mood` |
| `client.js` | `const API` | 必须与 `ROUTE_PREFIX` 一致 |
| `client.js` | `const PANEL_ID` / `NAV_LABEL` | 侧栏图标 id 与主面板 key（必须相同） |
| `assets/widget.js` | `var B` | 必须与 `ROUTE_PREFIX` 一致 |
| `package.json` | `name` / `repository.url` | 包名与自更新地址 |
| `cordis.patch.yml` | `id` / `name` | Loader entry |

---

## 十一、开发

```bash
node tests/decay.test.mjs            # 衰减数值正确性（6 项）
node test/stale-judgments.test.mjs   # 陈旧判断 / 竞态回归（19 项）
node test/bigfish-v1.test.mjs        # 本轮改造（15 项）
```

> ⚠️ 本机沙箱下 `node --test` 会 `spawn EPERM`，必须直接 `node <file>` 跑。

## 十二、许可

MIT。上游版权归 Yuuyuko-uu，详见 [NOTICE](NOTICE)。
