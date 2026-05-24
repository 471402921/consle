# 通信协议权威定义：场景切换 + 进食 + 睡眠

> **协议版本**: v2（2026-05-24）
> **权威方**: app 端（cute_pet 分支）—— console **必须严格遵循**本文档定义的 Command 格式和行为语义。
> **通信通道**: `wss://console.ewow.cn:18789/relay`，走现有 envelope 格式，`msg` 字段填下方 JSON。

---

## 1. 角色状态模型

角色在任意时刻处于以下状态之一：

| 状态 | 含义 | CHARACTER_STATE.animation 值 |
|------|------|------------------------------|
| **autonomous（游荡）** | GD 内部 AI 驱动，随机走动/趴下/打哈欠 | `walk_south` / `walk-north` / `walk_east` / `walk-west` / `idle_south` / `lie-down` / `yawn` |
| **external（遥控）** | console 推方向驱动 | 移动中: `walk_south` / `walk-north` / `walk_east` / `walk-west`；**停止时: `idle_south`** |
| **eating（进食）** | 场景脚本驱动，角色走到食物位置吃东西 | `walk_*`（走过去）→ `eating` / `happy-jumping`（吃东西）→ 回到 autonomous |
| **sleeping（睡眠）** | 角色原地打哈欠后进入睡眠循环 | `yawn`（~3.5 秒前置）→ `sleeping`（循环，直到 WAKE） |

### 1.1 关键行为说明

- **遥控停止时 = idle**：console 发 `CHARACTER_SET_VELOCITY { x: 0, y: 0 }` 时，角色播放 `idle_south`（站立朝南），**不是**行走动画
- **打哈欠是睡眠的前置子动画**：`yawn` 播完一轮（~3.5 秒）后自动过渡到 `sleeping`。console 不需要单独触发 yawn
- **autonomous 模式下的随机打哈欠**：GD 内部 AI 有 30% 概率在游荡间隙随机触发 yawn（设计师小巧思），这与 console 无关，console 在 CHARACTER_STATE 中看到 `yawn` 动画是正常的

---

## 2. Commands（console → relay → app）

### 2.1 SCENE_LOAD — 切换场景

```json
{
  "type": "SCENE_LOAD",
  "payload": { "scene": "outdoor_scene" }
}
```

| 字段 | 类型 | 值域 | 必填 |
|------|------|------|------|
| `scene` | string | `"interior_scene"` \| `"outdoor_scene"` | 是 |

**行为**：
- 加载目标场景，角色迁移到新场景并恢复游荡
- 目标已是当前场景 → 不重复加载，直接返回 `SCENE_LOADED`
- **保持 external control 状态**（遥控中切场景 → 切后仍在遥控）
- 切场景会**中断**正在进行的进食和睡眠

**响应事件**: `SCENE_LOADED`

### 2.2 CHARACTER_SET_EXTERNAL_CONTROL — 开/关遥控

```json
{
  "type": "CHARACTER_SET_EXTERNAL_CONTROL",
  "payload": { "enabled": true }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | `true`=遥控模式，`false`=恢复自主游荡 |

**行为**：
- `enabled: true`：角色停止当前行为（游荡/进食/睡眠全部中断），等待 `CHARACTER_SET_VELOCITY` 推方向
- `enabled: false`：角色恢复 autonomous 游荡
- 开启遥控时角色**立刻静止**，播放 `idle_south`，等待方向指令

### 2.3 CHARACTER_SET_VELOCITY — 推方向（遥控模式专用）

```json
{
  "type": "CHARACTER_SET_VELOCITY",
  "payload": { "x": 50, "y": 0 }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `x` | number | 水平速度（px/sec），正=右，负=左 |
| `y` | number | 垂直速度（px/sec），正=下，负=上 |

**行为**：
- 仅在 external control 模式下生效
- `x: 0, y: 0` → 角色**站立不动**，播放 `idle_south`（**不是**行走动画）
- 非零值 → 角色移动，播放对应方向的行走动画

**动画方向映射**：
| 条件 | 动画 |
|------|------|
| `x=0, y=0` | `idle_south` |
| `|x| > |y|, x > 0` | `walk_east` |
| `|x| > |y|, x < 0` | `walk-west` |
| `|y| >= |x|, y > 0` | `walk_south` |
| `|y| >= |x|, y < 0` | `walk-north` |

### 2.4 CHARACTER_FEED — 触发进食

```json
{
  "type": "CHARACTER_FEED",
  "payload": {}
}
```

**前置条件**：角色必须在 **autonomous 模式**。若当前在 external control，需**先发** `CHARACTER_SET_EXTERNAL_CONTROL { enabled: false }`。

**行为**：
- **室内场景**：角色自动走到餐桌，食物出现，播放进食动画序列（走过去 → happy-jumping → eating → 食物消失 → happy-jumping → 恢复游荡）
- **室外场景**：角色走到野餐垫位置，铺垫子，同样的进食序列
- 进食中角色自动走位，**不需要** console 推方向
- 如果正在睡觉，进食不会自动中断 — 需要先发 `CHARACTER_WAKE`

### 2.5 CHARACTER_STOP_FEED — 中断进食

```json
{
  "type": "CHARACTER_STOP_FEED",
  "payload": {}
}
```

**行为**：
- 立即中断进食，角色恢复游荡
- 当前没在进食 → 无副作用（safe to call anytime）

### 2.6 CHARACTER_SLEEP — 触发睡眠

```json
{
  "type": "CHARACTER_SLEEP",
  "payload": {}
}
```

**前置条件**：角色必须在 **autonomous 模式**。若当前在 external control，需**先发** `CHARACTER_SET_EXTERNAL_CONTROL { enabled: false }`。

**行为**：
- 角色**原地**打哈欠（`yawn`，约 3.5 秒前置动画）→ 自动过渡到 `sleeping` 循环动画
- 室内 / 室外表现一致，不需要走到特定位置
- 睡眠**无限持续**，直到收到 `CHARACTER_WAKE`
- 如果正在进食，**睡眠会中断进食**

**CHARACTER_STATE 动画变化顺序**：
```
当前动画 → "yawn"（~3.5秒）→ "sleeping"（循环）
```

### 2.7 CHARACTER_WAKE — 唤醒角色

```json
{
  "type": "CHARACTER_WAKE",
  "payload": {}
}
```

**行为**：
- 立即中断睡眠，角色恢复游荡
- 当前没在睡觉 → 无副作用（safe to call anytime）

---

## 3. Events（app → relay → console）

### 3.1 SCENE_LOADED — 场景加载完成

```json
{
  "type": "SCENE_LOADED",
  "payload": { "scene": "outdoor_scene" }
}
```

- console 收到后应更新 UI 显示当前场景
- 初始默认场景 = `"interior_scene"`

### 3.2 CHARACTER_STATE — 角色状态上报（5Hz）

```json
{
  "type": "CHARACTER_STATE",
  "payload": {
    "position": { "x": 45.2, "y": -30.8 },
    "animation": "idle_south",
    "control_mode": "autonomous"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `position.x` | number | 角色在场景内的 x 坐标（像素） |
| `position.y` | number | 角色在场景内的 y 坐标（像素） |
| `animation` | string | 当前播放的动画名（见下表） |
| `control_mode` | `"autonomous"` \| `"external"` | 当前控制模式 |

**所有可能的 animation 值**：

| animation | 含义 | 出现场景 |
|-----------|------|----------|
| `idle_south` | 站立朝南（默认 idle） | 停止移动时 |
| `walk_south` | 向南走 | 移动中 |
| `walk-north` | 向北走 | 移动中 |
| `walk_east` | 向东走 | 移动中 |
| `walk-west` | 向西走 | 移动中 |
| `lie-down` | 趴下 | autonomous 随机行为 |
| `yawn` | 打哈欠 | autonomous 随机 / 睡眠前置动画 |
| `sleeping` | 睡觉（循环） | CHARACTER_SLEEP 触发后 |
| `eating` | 吃东西（循环） | CHARACTER_FEED 触发后 |
| `happy-jumping` | 开心跳 | 进食前后的过渡动画 |

> **注意**: 动画名的命名不完全一致（有的用下划线 `walk_south`，有的用连字符 `walk-west`），这是设计师素材命名历史原因。console 应**精确匹配**这些字符串，不要做正规化处理。

### 3.3 BRIDGE_ERROR — 错误事件

```json
{
  "type": "BRIDGE_ERROR",
  "payload": {
    "code": "INVALID_MESSAGE",
    "message": "CHARACTER_SET_VELOCITY payload missing 'x'/'y'",
    "originalType": "CHARACTER_SET_VELOCITY"
  }
}
```

| code | 含义 |
|------|------|
| `INVALID_MESSAGE` | payload 格式错误（缺字段 / 类型不对） |
| `UNKNOWN_TYPE` | type 字段不在已知 Command 集合内 |
| `HANDLER_ERROR` | Command 格式正确但处理时出错（如找不到角色节点） |

---

## 4. 操作互斥关系

| 操作 | 与 external control | 与进食 | 与睡眠 | 与场景切换 |
|------|---------------------|--------|--------|-----------|
| **开启遥控** | — | 中断进食 | 中断睡眠 | 兼容 |
| **喂食** | 无效（需先关遥控） | — | 不自动中断睡眠 | 切场景会中断 |
| **睡觉** | 无效（需先关遥控） | 中断进食 | — | 切场景会中断 |
| **场景切换** | 兼容（保持遥控状态） | 中断进食 | 中断睡眠 | — |

### 4.1 Console 推荐操作流程

**喂食**：
```
1. 若 control_mode == "external" → 发 CHARACTER_SET_EXTERNAL_CONTROL { enabled: false }
2. 发 CHARACTER_FEED
3. 观察 CHARACTER_STATE.animation 变化：walk_* → happy-jumping → eating → happy-jumping → idle_south
```

**睡觉**：
```
1. 若 control_mode == "external" → 发 CHARACTER_SET_EXTERNAL_CONTROL { enabled: false }
2. 发 CHARACTER_SLEEP
3. 观察 CHARACTER_STATE.animation 变化：当前动画 → yawn（~3.5s）→ sleeping（循环）
4. 需要唤醒时 → 发 CHARACTER_WAKE
```

**遥控移动**：
```
1. 发 CHARACTER_SET_EXTERNAL_CONTROL { enabled: true }
2. 持续发 CHARACTER_SET_VELOCITY { x, y }（摇杆偏移映射到速度）
3. 松开摇杆 → 发 CHARACTER_SET_VELOCITY { x: 0, y: 0 }（角色站立不动，显示 idle_south）
4. 结束遥控 → 发 CHARACTER_SET_EXTERNAL_CONTROL { enabled: false }
```

---

## 5. Console UI 建议

### 5.1 场景切换区

```
[ 🏠 室内 ]  [ 🌳 室外 ]
```

- 高亮当前场景（根据 `SCENE_LOADED` 事件更新）
- 点击非当前场景 → 发 `SCENE_LOAD`
- 切换期间可加 loading 态（通常 < 500ms）

### 5.2 进食控制区

```
[ 🍖 喂食 ]  [ ⏹ 停止喂食 ]
```

- external control 开启时应 **disable**（前置条件不满足）
- 点"喂食"前自动检查 `control_mode`，如果是 `"external"` 则先发 `CHARACTER_SET_EXTERNAL_CONTROL { enabled: false }`

### 5.3 睡眠控制区

```
[ 💤 睡觉 ]  [ ☀️ 叫醒 ]
```

- external control 开启时应 **disable**
- 与喂食同理，点"睡觉"前检查 `control_mode`

### 5.4 状态显示

显示 `CHARACTER_STATE` 的 `animation` 字段。console 可根据动画名做中文映射：

| animation | 中文显示建议 |
|-----------|-------------|
| `idle_south` | 站立 |
| `walk_*` / `walk-*` | 走路 |
| `lie-down` | 趴下 |
| `yawn` | 打哈欠 |
| `sleeping` | 睡觉中 |
| `eating` | 吃东西 |
| `happy-jumping` | 开心跳 |

---

## 6. 完整 Command/Event 速查

### Commands（console → app）

| type | payload | 说明 |
|------|---------|------|
| `SCENE_LOAD` | `{ scene: string }` | 切换场景 |
| `CHARACTER_SET_EXTERNAL_CONTROL` | `{ enabled: bool }` | 开/关遥控 |
| `CHARACTER_SET_VELOCITY` | `{ x: number, y: number }` | 推方向（遥控模式专用） |
| `CHARACTER_FEED` | `{}` | 触发进食 |
| `CHARACTER_STOP_FEED` | `{}` | 中断进食 |
| `CHARACTER_SLEEP` | `{}` | 触发睡眠 |
| `CHARACTER_WAKE` | `{}` | 唤醒角色 |

### Events（app → console）

| type | payload | 频率 |
|------|---------|------|
| `SCENE_LOADED` | `{ scene: string }` | 每次场景加载完成 |
| `CHARACTER_STATE` | `{ position, animation, control_mode }` | 5Hz 持续上报 |
| `BRIDGE_ERROR` | `{ code, message, originalType? }` | 出错时 |

---

## 7. 联调验证清单

- [ ] 室内 → 发 `SCENE_LOAD { scene: "outdoor_scene" }` → 收到 `SCENE_LOADED { scene: "outdoor_scene" }`
- [ ] 室外 → 发 `SCENE_LOAD { scene: "interior_scene" }` → 收到 `SCENE_LOADED { scene: "interior_scene" }`
- [ ] 遥控模式下发 `CHARACTER_SET_VELOCITY { x: 0, y: 0 }` → `CHARACTER_STATE.animation` 应为 `idle_south`（**不是** `walk-north`）
- [ ] 遥控模式下发非零速度 → `CHARACTER_STATE.animation` 应为对应方向的 `walk_*`
- [ ] 关闭遥控 → `CHARACTER_STATE.control_mode` 变为 `autonomous`，角色恢复游荡
- [ ] 室内发 `CHARACTER_FEED` → 角色走到餐桌 → `animation` 依次出现 `walk_*` → `happy-jumping` → `eating` → `happy-jumping` → `idle_south`
- [ ] 室外发 `CHARACTER_FEED` → 角色走到野餐垫 → 同样进食序列
- [ ] 进食中发 `CHARACTER_STOP_FEED` → 角色恢复游荡
- [ ] 发 `CHARACTER_SLEEP` → `animation` 变为 `yawn`（~3.5 秒）→ 变为 `sleeping`（循环）
- [ ] 睡眠中发 `CHARACTER_WAKE` → 角色恢复游荡
- [ ] 进食中发 `CHARACTER_SLEEP` → 进食中断，角色进入睡眠
- [ ] 遥控模式下发 `CHARACTER_FEED` / `CHARACTER_SLEEP` → 无效果（角色不响应）
- [ ] 遥控中切场景 → 切后仍在遥控模式（`control_mode` 保持 `external`）
- [ ] 进食中切场景 → 进食中断，角色在新场景恢复游荡
- [ ] 睡眠中切场景 → 睡眠中断，角色在新场景恢复游荡

---

## 修订记录

| 日期 | 版本 | 改动 |
|------|------|------|
| 2026-05-24 | v2 | 重写为权威协议定义；修复遥控零速度 idle 行为说明；修复睡眠流程（yawn→sleeping 过渡）；增加完整 animation 值表 |
| 2026-05-24 | v1 | 初版：场景切换 + 进食 + 睡眠 handoff |
