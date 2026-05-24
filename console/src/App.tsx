import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Envelope, CharacterState, SceneLoaded, SceneName, BridgeError } from "@cute/shared";
import { isValidRoomId } from "@cute/shared";
import { RelayClient, type ConnectionStatus } from "./client/RelayClient";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { CharacterView } from "./components/CharacterView";
import { ControlPanel } from "./components/ControlPanel";
import "./App.css";

const DEFAULT_RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";

export function App(): JSX.Element {
  const [roomId, setRoomId] = useState(import.meta.env.VITE_DEFAULT_ROOM_ID ?? "");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [lastEnvelope, setLastEnvelope] = useState<Envelope | null>(null);
  const [characterState, setCharacterState] = useState<CharacterState["payload"] | null>(null);
  const [currentScene, setCurrentScene] = useState<SceneName>("interior_scene");
  const [sceneLoading, setSceneLoading] = useState(false);
  const [lastError, setLastError] = useState<BridgeError["payload"] | null>(null);
  const clientRef = useRef<RelayClient | null>(null);

  const cleanupClient = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, []);

  useEffect(() => cleanupClient, [cleanupClient]);

  const handleConnect = useCallback(() => {
    if (!isValidRoomId(roomId)) {
      alert("room_id 至少 32 字符(MVP 鉴权)");
      return;
    }
    cleanupClient();
    const client = new RelayClient({ url: DEFAULT_RELAY_URL, roomId });
    client.onStatus(setStatus);
    client.onMessage((env) => {
      setLastEnvelope(env);
      const msg = env.msg as { type?: string };
      if (msg?.type === "CHARACTER_STATE") {
        setCharacterState((env.msg as CharacterState).payload);
      }
      if (msg?.type === "SCENE_LOADED") {
        const scene = (env.msg as SceneLoaded).payload.scene;
        setCurrentScene(scene);
        setSceneLoading(false);
      }
      if (msg?.type === "BRIDGE_ERROR") {
        setLastError((env.msg as BridgeError).payload);
      }
    });
    client.connect();
    clientRef.current = client;
  }, [roomId, cleanupClient]);

  const handleDisconnect = useCallback(() => {
    cleanupClient();
    setStatus("disconnected");
  }, [cleanupClient]);

  const sendCommand = useCallback(<T,>(msg: T) => {
    clientRef.current?.send(msg);
  }, []);

  const connected = status === "connected";
  const debugUrl = useMemo(() => DEFAULT_RELAY_URL, []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>cute pixel console</h1>
        <small>{debugUrl}</small>
      </header>

      <ConnectionPanel
        roomId={roomId}
        onRoomIdChange={setRoomId}
        status={status}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <CharacterView state={characterState} lastEnvelope={lastEnvelope} lastError={lastError} />

      <ControlPanel
        disabled={!connected}
        onSend={sendCommand}
        currentScene={currentScene}
        sceneLoading={sceneLoading}
        onSceneLoadStart={() => setSceneLoading(true)}
      />
    </div>
  );
}
