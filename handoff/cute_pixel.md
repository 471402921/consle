# cute_pixel 对接清单(console + relay → cute_pixel app)

> Status: Draft (2026-05-16)。本文档由 console + relay 项目这边发出,作为联调 cute_pixel app 端的工作清单。对应 console/relay requirements §9 blocker 列表的 7 项。

## 背景

我们正在给 cute_pixel app 加一个**外部浏览器控制台**,允许通过浏览器远程接管室内场景里的小狗角色。

```
[cute_pixel app] --(WSS, client)--> [relay] <--(WSS, client)-- [browser console]
       │                                  │                                  │
   启动期 connect,                    按 room_id 透传,                手动输入 room_id 加入
   订阅 room_id                       不解 message 体                  渲染状态 + 发指令
   收下行 → godotBridge.send          只做 broadcast                  
   GD event → 上行
```

- **console** 和 **relay** 已经 scaffold 完成,本地能跑通,relay 透传双向已通过 smoke test
- **cute_pixel app** 这边需要做的就是本文档列出的 1-7 项,做完即可联调
- 不在本文档范围:console UI、relay 部署、TLS 证书 — 我们这边负责

---

## 契约:必须字面一致

下面这些**字符串和形状**必须跟 console 端完全一致,否则双方解不开。任何字段名 / type 字符串改动都要先同步两边。

### Envelope(网络层信封)

这是 app ↔ relay ↔ console 之间走 WebSocket 的外层包装。relay **不解**它,只按 `room_id` + 推断的反向 `role` 转发。

```ts
export type Role = "app" | "console";

export interface Envelope<Msg = unknown> {
  room_id: string;   // 同一 room_id 双方必须一致
  from: Role;        // app 端固定 "app"
  ts: number;        // Date.now()
  msg: Msg;          // 实际业务消息(GodotCommand 或 GodotEvent)
}
```

> ⚠️ envelope 这一层**不进 `proto/`** — `proto/` 是 RN ↔ GD 契约,envelope 是网络层契约,两层分开。

### URL 形态

```
wss://<relay-host>/room/<room_id>?role=app
```

- `room_id` 必须 **≥ 32 字符**(MVP 鉴权 = room_id-as-token)。低于 32 字符 relay 会返回 HTTP 403。
- `role` 必须是 `app` 或 `console`。其他值返回 HTTP 400。
- 心跳:relay 30s 发一次 ws 协议级 ping,3 次 miss 强断。**应用层不需要再做心跳**,浏览器/RN 的 WebSocket 自动回 pong。

### 新增 proto messages(下面 §1 详写)

3 条新 message,**type 字符串字面一致**:

| Direction | type | payload |
|---|---|---|
| console → app → GD | `CHARACTER_SET_EXTERNAL_CONTROL` | `{ enabled: boolean }` |
| console → app → GD | `CHARACTER_SET_VELOCITY` | `{ x: number, y: number }` (单位 px/sec) |
| GD → app → console | `CHARACTER_STATE` | `{ position: {x,y}, animation: string, control_mode: "autonomous" \| "external" }` |

---

## 7 项工作清单

### 1. 扩展 proto

**`proto/messages.ts`** — 在现有 SCENE_LOAD / UNLOAD / SCENE_LOADED / BRIDGE_ERROR 之外加:

```ts
// Commands(console → app → GD)
export interface CharacterSetExternalControl {
  type: "CHARACTER_SET_EXTERNAL_CONTROL";
  payload: { enabled: boolean };
}

export interface CharacterSetVelocity {
  type: "CHARACTER_SET_VELOCITY";
  payload: { x: number; y: number };  // px/sec,zero vector = 站立但仍在 external 模式
}

// Events(GD → app → console)
export interface CharacterState {
  type: "CHARACTER_STATE";
  payload: {
    position: { x: number; y: number };  // global_position
    animation: string;                    // sprite.animation 名
    control_mode: "autonomous" | "external";
  };
}

// 更新 GodotCommand / GodotEvent 联合类型,把上面 3 个加进去
```

**`proto/messages.gd`** — 加常量,字符串字面值必须跟 TS 一致:

```gdscript
const CHARACTER_SET_EXTERNAL_CONTROL := "CHARACTER_SET_EXTERNAL_CONTROL"
const CHARACTER_SET_VELOCITY        := "CHARACTER_SET_VELOCITY"
const CHARACTER_STATE               := "CHARACTER_STATE"
```

> **ADR-007 同步修订**:这是 proto 从"场景级"扩到"实体级"的第一次。建议在 ADR-007 加一条 *entity scoping* 约束(实体级 message 用 `<ENTITY>_<VERB>` 命名,payload 内部不再嵌实体类型),避免以后 messages 数量爆炸。

---

### 2. 实装 `services/realtime/WebSocketClient.ts`

当前是 stub,要做的:

```ts
class WebSocketClient {
  // 连 relay
  connect(url: string, roomId: string) {
    this.ws = new WebSocket(`${url}/room/${encodeURIComponent(roomId)}?role=app`);
    this.ws.onmessage = (e) => {
      const env = JSON.parse(e.data) as Envelope;
      // 只把 msg 字段透给 godotBridge,envelope 壳剥掉
      godotBridge.send(env.msg);
    };
    this.ws.onopen  = () => this.setStatus("connected");
    this.ws.onclose = () => { this.setStatus("disconnected"); this.scheduleReconnect(); };
  }

  // GD 事件 → 上行
  // 在某个 init 里订阅 godotBridge,把 event 包成 envelope 发出
  init() {
    godotBridge.subscribe((event) => {
      const env: Envelope = {
        room_id: this.roomId,
        from: "app",
        ts: Date.now(),
        msg: event,
      };
      this.ws?.send(JSON.stringify(env));
    });
  }
}
```

**重连规则**:指数退避 **1 / 2 / 4 / 8 / 16 秒,5 次后停止**(跟 console 端规则一致)。失败后 `useConnectionStatus` 进 `failed` 态,UI 显示红色 indicator。

**心跳**:不用应用层做。relay 走 ws 协议级 ping,WebSocket 标准库自动回 pong。

---

### 3. 双向路由

在 `services/realtime/` 加一个模块(姑且叫 `realtimeBridge.ts`):

```
console 下行 ─► WebSocketClient.onMessage(env) ─► godotBridge.send(env.msg)
GD 事件 ────► godotBridge.subscribe(ev)        ─► WebSocketClient.send(envelope wrap ev)
              WebSocketClient.onStatus ─────────► useConnectionStatus store
```

App 启动期(或顶层 Provider mount)调 `realtimeBridge.start()`,unmount 调 `.stop()`。

---

### 4. GD 端 `MessageBridge.gd` handler

加两个 case 调用 character.gd 已有的方法:

```gdscript
match msg.type:
    "CHARACTER_SET_EXTERNAL_CONTROL":
        var character = get_node("/root/.../Character")  # 按当前 scene 路径
        character.set_external_control(msg.payload.enabled)
    "CHARACTER_SET_VELOCITY":
        var character = get_node("/root/.../Character")
        character.set_external_velocity(Vector2(msg.payload.x, msg.payload.y))
```

> `character.gd` 的 `set_external_control(enabled)` / `set_external_velocity(v)` **已经存在**(requirements §1 列的占位),**不需要新加 GD 方法**,只需在 bridge 里调它们。

---

### 5. GD 端 `character.gd` 上报 CHARACTER_STATE

`_physics_process` 默认 60Hz,**节流到 5Hz**(每 12 frame 一次):

```gdscript
var _state_tick := 0

func _physics_process(_delta):
    # ... 已有逻辑 ...

    _state_tick += 1
    if _state_tick >= 12:  # 5Hz
        _state_tick = 0
        var ev = {
            "type": "CHARACTER_STATE",
            "payload": {
                "position": {"x": global_position.x, "y": global_position.y},
                "animation": $AnimatedSprite2D.animation,  # 按实际节点名
                "control_mode": "external" if _external_control else "autonomous",
            },
        }
        MessageBridge.emit_event(ev)  # 走现有 GD → RN 上行通道
```

> **12 帧节流不能省**。60Hz 直发会压垮 WebSocket(以及让 console 缩略图无谓刷新)。

---

### 6. ConnectionIndicator 接真信号

`app/features/room/components/ConnectionIndicator.tsx` 已经在,但目前是占位。接 `useConnectionStatus` 真实状态:

- `disconnected` → 灰点 + "未连接"
- `connecting` / `reconnecting` → 黄点 + "连接中" / "重连中"
- `connected` → 绿点 + "已连接"
- `failed`(5 次重连用尽) → 红点 + "已失败"(建议同时弹个 toast 提示用户检查 relay URL)

---

### 7. env 配置

`app/services/env/` 加两个 key(stub 已留位置):

```
REALTIME_URL=wss://cute-relay.example.com   # 部署后填真实域名
REALTIME_ROOM_ID=<32+ 字符随机串>           # 跟 console 端共用
```

**开发期临时方案**:
- `REALTIME_URL=ws://localhost:8080`(我们本地 relay)
- `REALTIME_ROOM_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`(40 个 x,够 32 字符)
- 注意是 `ws://` 不是 `wss://`,本地没 TLS
- 浏览器禁止 HTTPS 页面连 WS,所以本地 console 也必须用 `http://localhost:5173`,不能 https

**room_id 怎么生成 / 分发** 还是 open question(requirements §10 q1),先 hardcode 一个固定串够 MVP 用,生产期再看是不是给 app 嵌二维码 + 时效 token。

---

## 验收清单

按这 3 步逐项验,3 步都过即对接 OK:

1. **app 启动 + console 同 room**:RN debugger 看到 `[WebSocketClient] connected`,浏览器 console 状态灯变绿(说明 app 进 room 了)。
2. **console 控制角色**:浏览器 console 点 "切到 external" + 方向键 → GD 角色立刻原地走动,且 `character.control_mode` 切到 `external`。点 "切回 autonomous" → 角色恢复自己 `_pick_new_action`。
3. **console 5Hz 看到状态**:浏览器 console "角色状态" panel 每 ~200ms 刷一次 position 数字,动画名跟着 GD 当前动画变化。

如果哪一步卡住,把现象 + RN console 日志 + GD `_print` 日志贴回来,我们一起 debug。

---

## 联调地址(2026-05-17 已上线)

```
relay URL    : wss://1.14.190.95:18789/relay     # 直接用,无需域名
console URL  : https://1.14.190.95:18789/        # 浏览器看
开发期 relay : ws://localhost:8080                # 本地 npm run dev:relay
```

**注意**:
- TLS 是 self-signed cert,浏览器会弹"不安全"警告 → 点继续访问。**RN WebSocket 也可能因此握手失败**,具体看 RN 配置:
  - iOS: `Info.plist` 加 `NSAllowsArbitraryLoads = true`(测试期可接受,正式发版前要换正经 cert)
  - Android: `network_security_config.xml` 允许 `1.14.190.95`
  - 或者更稳:在 RN 端的 WebSocketClient 实装时跳过 cert 校验(仅 dev / test 期),正式上线前必须撤掉。
- 443 上跑的 `asset-lab` 是另一个项目,跟本对接无关。
- room_id 双方约好用同一个 32+ 字符串,MVP 期 hardcode 一个即可。比如 `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`(40 个 x)够用。

---

## 参考(console + relay 源码,内部参考用)

- 契约源:[../shared/src/envelope.ts](../shared/src/envelope.ts), [../shared/src/proto.ts](../shared/src/proto.ts)
- RelayClient 重连逻辑可参考:[../console/src/client/RelayClient.ts](../console/src/client/RelayClient.ts)
- relay 实现 (广播 / 校验):[../relay/src/server.ts](../relay/src/server.ts)
- 需求总文档:[../requirements.md](../requirements.md)
