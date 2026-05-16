# Console — cute_pixel 远程控制台需求文档

> Status: Draft(2026-05-16)。控制台是独立前端项目,本文档是给后续 console + relay repo 的需求起点,以及给 cute_pixel 这边补 proto/realtime 实装的契约约束。

## 1. 是什么

一个独立的 **web 前端**(`console`)+ 一个 **relay server**,允许通过浏览器跨网络远程控制 cute_pixel app 里的 Godot 像素场景(当前 demo:`cute_pet` 室内场景里的小狗角色)。

App 端的占位已经留好:
- `app/services/realtime/WebSocketClient.ts`(stub)
- `app/services/realtime/useConnectionStatus.ts`(状态 store)
- `app/features/room/components/ConnectionIndicator.tsx`(右上"● 未连接/连接中/已连接"指示)
- `godot_project/character/character.gd` 的 `set_external_control(enabled)` + `set_external_velocity(v)` 公共方法

本文档定义的是**外部控制台 + relay server + 双侧协议扩展**,不重复 cute_pixel 底座已经做的事。

## 2. 受众 / 使用场景

- **开发者**:debug 期手动 takeover 角色,端到端验证 ADR-007 message bus 通畅
- **设计师**:在 Godot 编辑器之外、直接在 RN 嵌入环境下手玩素材
- **对外演示**:绕开 autonomous 的不可控,有人在远端遥操作

**非目标**(明确不做):
- 不是终端用户产品
- 不做账号体系 / 多人协作 / 操作持久化
- 不做生产灰度 / 灰发 / A/B
- 不做 mobile console(MVP 只 desktop browser)

## 3. 总体架构

```
[cute_pixel app] --(WSS, client)--> [relay server] <--(WSS, client)-- [browser console]
       │                                  │                                    │
   启动期 connect,                    按 room_id 透传,                  手动输入 room_id 加入
   订阅 room_id                       不解 message 体                    (或扫 QR)
   收下行 → godotBridge.send          只做 broadcast                     渲染状态 + 发指令
   GD event → 上行
```

- **app**:在 `services/realtime/WebSocketClient.ts` 实装(目前 stub),app 启动期 connect 后:
  - 注册 room_id 到 relay
  - 收 console 下行 → 走 `godotBridge.send` 派到 GD
  - 收 GD event → 上行透传给 relay → 转 console
- **relay**:小 server,只做 room 管理 + 透传,**不解协议体**
- **console**:浏览器,连同一 room_id,渲染状态 + 发指令

App 既不是 server 也不是 console,**两端都是 client,通过 relay 解耦**。这样跨 NAT / 跨网络(手机 4G + 电脑 WiFi)都能用。

## 4. MVP 范围

### 必须做

1. **连接管理**
   - app 启动期 connect relay(URL + room_id 配置化,见 §8)
   - console 输入 room_id 加入同一 room
   - app 右上 indicator 反映:未连接 / 连接中 / 已连接(已实装,只需接 WebSocketClient 真信号)
   - 双方掉线自动重连(指数退避,5 次后停止)

2. **角色接管**
   - console 上 toggle:`autonomous ↔ external control`
   - external 模式:console 推方向(WASD / 方向键 / 屏幕摇杆都行,前端自决),app → GD 调 `set_external_velocity(Vector2)`
   - autonomous 切回:console 一键放手,GD 内部自己重选 `_pick_new_action`

3. **状态回显**
   - app 周期上报角色 state(`global_position` + 当前动画名 + control_mode)给 console,默认 5Hz
   - console 显示:角色 position 数值 + 简陋小地图(viewport rect + 角色点)

### 不在 MVP

- 场景切换(当前 demo 单 scene `interior_scene`,够用)
- 加载 / 删除 / 移动家具
- FPS / 内存 / GC 调试 dump
- 操作录像、回放
- 多 console 同时控同一 app 的冲突解决
- 鼠标点选 = 把角色拖到屏幕某点(吸引人但 MVP 不做)

## 5. 对 cute_pixel 的协议扩展提议(待 ADR-007 增补)

`proto/messages.ts` + `proto/messages.gd` 当前只有 SCENE_LOAD/UNLOAD + SCENE_LOADED/BRIDGE_ERROR。MVP 需新增:

### 5.1 Commands(console → app → GD)

```ts
// console 端开 / 关 takeover
{ type: "CHARACTER_SET_EXTERNAL_CONTROL", payload: { enabled: boolean } }

// console 推方向;velocity 单位 px/sec,zero vector = 站立但仍在 external 模式
{ type: "CHARACTER_SET_VELOCITY", payload: { x: number, y: number } }
```

GD 侧 `MessageBridge.dispatch` 加 handler 调 `find_node("Character").set_external_control(...) / set_external_velocity(...)`。

### 5.2 Events(GD → app → console)

```ts
{ 
  type: "CHARACTER_STATE", 
  payload: {
    position: { x: number, y: number },  // global_position
    animation: string,                    // 当前 sprite.animation 名
    control_mode: "autonomous" | "external"
  } 
}
```

频率约束:GD 端 `_physics_process` 默认 60Hz tick,**节流到 5Hz** 上报(每 12 frame 一次),避免压垮 WebSocket。

### 5.3 Envelope(relay 层,**不进 proto/**)

relay 不解 message 体,只按 room_id + role broadcast。建议 envelope 形态:

```json
{
  "room_id": "...",
  "from": "app" | "console",
  "ts": 1731700000000,
  "msg": { /* GodotCommand 或 GodotEvent,relay 不动 */ }
}
```

具体字段由 console + relay repo 双方约定,**不进 cute_pixel/proto/**(proto 是 RN ↔ GD 契约,envelope 是 console ↔ relay ↔ app 网络层契约,两层不同)。

## 6. relay server 需求

- **技术**:任意(Node + `ws` / Go `gorilla/websocket` / Rust `tungstenite` / Python `websockets`),无强制
- **部署**:云主机 / Docker / Vercel edge function 都行,单节点 MVP 够用(并发预期 < 100 room)
- **API 形态**:
  - `WSS /room/{room_id}?role=app|console`
  - 收到 frame → broadcast 到同 room 内**反向 role** 的所有连接(app 发的只给 console,反之亦然)
- **鉴权**:MVP 阶段 room_id 即 token(要求 ≥ 32 字符,不可猜),后期可加 JWT
- **心跳**:30s ping/pong,3 次 miss 断开
- **日志**:连接 / 断开 / room 计数,**不**记 message 体(隐私 + 减压)

## 7. console 前端需求

- **框架**:任意(React / Vue / Svelte / 纯 HTML 都行),前端 repo 自决
- **部署**:静态站点(Vercel / Cloudflare Pages / GitHub Pages)
- **UI 草案**:
  - 顶部:room_id 输入框 + 连接按钮 + 状态灯
  - 中部:viewport 缩略图(矩形)+ 角色位置点(根据 CHARACTER_STATE.position 实时更新)+ 当前动画名 label
  - 底部:autonomous/external toggle + 方向输入(8 方向按钮 / 摇杆 / WASD 键盘监听任选)
- **跨网络要求**:必须 HTTPS + WSS(浏览器禁止 HTTPS 页面连 WS,只能 WSS)
- **响应式**:desktop only,不做 mobile

## 8. 部署形态(MVP 草案)

```
relay   : wss://cute-relay.example.com           # 自部署,单节点 1-2 USD/月
console : https://cute-console.example.com       # 静态站点(Vercel / CF Pages)
app 配置: .env 或 app config 拼:
          REALTIME_URL=wss://cute-relay.example.com
          REALTIME_ROOM_ID=<32+ 字符随机串>
```

app 这边需要在 `services/env/` 加这两个 env key(目前 stub 已留位置)。

## 9. 阻塞 / 依赖

完成此控制台,**必须**先在 cute_pixel 这边做:

1. ✅ `services/realtime/` stub(已就绪)
2. ⏳ 扩展 `proto/messages.ts` + `proto/messages.gd` 加 CHARACTER_* messages(§5)
3. ⏳ `services/realtime/WebSocketClient.ts` 实装(connect + reconnect + envelope 拼装)
4. ⏳ `services/realtime/` 内加个 worker / store,把 console 下行 → `godotBridge.send`,把 `godotBridge.subscribe` 收的 GD event → 上行
5. ⏳ GD 端 `MessageBridge.gd` 加 CHARACTER_SET_EXTERNAL_CONTROL / CHARACTER_SET_VELOCITY handler
6. ⏳ GD 端 character.gd 加 CHARACTER_STATE 上报(5Hz 节流)
7. ⏳ `services/env/` 加 REALTIME_URL / REALTIME_ROOM_ID

控制台 + relay 是**独立项目**,可与上述 1-7 并行,但联调要等 2-7 都落地。

## 10. Open Questions(写控制台 / relay 前需先回答)

1. **room_id 怎么生成 / 分发?** 开发期 hardcode 一个就行;生产期是不是给 app 嵌入一个二维码 + 时效 token,让 console 扫码加入?
2. **多 app 同时连同一 room?** 当前协议假设 1 app + 1 console 一对一,如果允许多 app(比如设计师 + 开发者两台手机同一场景),需要 room 内 role 进一步区分
3. **离线 fallback 行为?** app 启动期连不上 relay 时已经自动走 autonomous(不阻塞 demo),需要给一个**用户可见的提示**吗?(toast / indicator 红色?)还是 silent?
4. **proto 扩展会影响 ADR-007**:CHARACTER_* messages 让 proto 从"场景级"扩到"实体级",需要 ADR-007 修订一条"entity scoping"约束(避免未来 messages 数量爆炸)
5. **console 观察模式?** 一个权限只看不发的 role(`role=observer`),给设计师同事围观开发者操作。MVP 不做,但 protocol 层是否预留?
6. **录像 / replay?** 把 console 发出的 commands 流录下来重放给同一 app,做 demo 测试。MVP 不做,但 envelope 加 `ts` 字段就是为这件事留口子。

## 11. 不在本文档内

- relay / console 的具体技术栈选择 → 由对应 repo 自决
- 控制台 UI 视觉设计 → 等前端 repo 起项目时画 mock
- 部署的 CI / 域名 / TLS 证书 → 部署时配
- cute_pixel 这边的 proto 扩展具体 PR → 等本需求确认后单开 cute_pixel commit

## 12. 修订记录

| 日期 | 改动 | 改动人 |
|---|---|---|
| 2026-05-16 | 初稿 | Jet + Claude |
