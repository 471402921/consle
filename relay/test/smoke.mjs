// Relay smoke test:模拟 app + console,验证 envelope 透传 + room_id/role 校验。
// 用法:先 `npm run dev -w @cute/relay`,再 `npm run smoke -w @cute/relay`。
import { WebSocket } from "ws";

const ROOM_ID = "x".repeat(40);
const SHORT_ID = "tooshort";
const BASE = process.env.RELAY_URL ?? "ws://localhost:8080";

function open(role, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/room/${roomId}?role=${role}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws.on("unexpected-response", (_, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const onMsg = (data) => { cleanup(); resolve(data.toString()); };
    const onErr = (e) => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error("closed before message")); };
    const cleanup = () => {
      ws.off("message", onMsg); ws.off("error", onErr); ws.off("close", onClose);
    };
    ws.on("message", onMsg); ws.on("error", onErr); ws.on("close", onClose);
  });
}

async function test1_shortRoomIdRejected() {
  try {
    await open("app", SHORT_ID);
    throw new Error("EXPECTED reject for short room_id");
  } catch (e) {
    if (e.message.startsWith("EXPECTED")) throw e;
    if (e.message.includes("HTTP 403")) {
      console.log("✓ short room_id → HTTP 403");
      return;
    }
    throw new Error(`unexpected error for short id: ${e.message}`);
  }
}

async function test2_invalidRoleRejected() {
  const ws = new WebSocket(`${BASE}/room/${ROOM_ID}?role=admin`);
  await new Promise((resolve, reject) => {
    ws.on("open", () => reject(new Error("EXPECTED reject for invalid role")));
    ws.on("error", () => resolve());
    ws.on("unexpected-response", (_, res) => {
      if (res.statusCode === 400) resolve();
      else reject(new Error(`unexpected status: ${res.statusCode}`));
    });
  });
  console.log("✓ invalid role → HTTP 400");
}

async function test3_envelopeBothWays() {
  const app = await open("app", ROOM_ID);
  const con = await open("console", ROOM_ID);

  const consoleMsg = {
    room_id: ROOM_ID, from: "console", ts: 1,
    msg: { type: "CHARACTER_SET_VELOCITY", payload: { x: 50, y: 0 } },
  };
  con.send(JSON.stringify(consoleMsg));
  const recv1 = JSON.parse(await nextMessage(app));
  if (recv1.from !== "console" || recv1.msg.type !== "CHARACTER_SET_VELOCITY") {
    throw new Error(`console→app mismatch: ${JSON.stringify(recv1)}`);
  }
  console.log("✓ console → app: CHARACTER_SET_VELOCITY 透传");

  const appMsg = {
    room_id: ROOM_ID, from: "app", ts: 2,
    msg: {
      type: "CHARACTER_STATE",
      payload: { position: { x: 100, y: 200 }, animation: "walk", control_mode: "external" },
    },
  };
  app.send(JSON.stringify(appMsg));
  const recv2 = JSON.parse(await nextMessage(con));
  if (recv2.from !== "app" || recv2.msg.type !== "CHARACTER_STATE") {
    throw new Error(`app→console mismatch: ${JSON.stringify(recv2)}`);
  }
  console.log("✓ app → console: CHARACTER_STATE 透传");

  app.close();
  con.close();
}

async function test4_sameRoleNoBroadcast() {
  const a = await open("console", ROOM_ID);
  const b = await open("console", ROOM_ID);

  const racePromise = Promise.race([
    nextMessage(b).then(() => "got"),
    new Promise((r) => setTimeout(() => r("timeout"), 300)),
  ]);
  a.send(JSON.stringify({ room_id: ROOM_ID, from: "console", ts: 3, msg: { type: "PING" } }));
  const result = await racePromise;
  if (result !== "timeout") throw new Error("EXPECTED no broadcast within same role");
  console.log("✓ 同 role 不互广播");

  a.close();
  b.close();
}

(async () => {
  try {
    await test1_shortRoomIdRejected();
    await test2_invalidRoleRejected();
    await test3_envelopeBothWays();
    await test4_sameRoleNoBroadcast();
    console.log("\nALL PASS");
    process.exit(0);
  } catch (e) {
    console.error("FAIL:", e.message);
    process.exit(1);
  }
})();
