/**
 * The single typed Socket.IO connection. Manages the handshake (sends the burner
 * pubkey per the PROMPT-4 contract), tracks connection status + player/credits,
 * and exposes a typed `emit` + `subscribe`. Feature components consume this.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  MAX_CREDITS,
  SocketEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type Player,
  type PlayerStatePayload,
  type CreditsUpdatedPayload,
  type PresenceUpdatePayload,
} from "@slop/shared";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface SocketCtx {
  status: ConnStatus;
  ready: boolean; // first player:state received
  pubkey: string;
  player: Player | null;
  credits: number;
  maxCredits: number;
  /** epoch ms of the next refill tick, or null if at cap / unknown. */
  refillTargetAt: number | null;
  /** live online counts (everyone online, split human vs larp). */
  presence: PresenceUpdatePayload;
  emit: <E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ) => void;
  subscribe: <E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
  ) => () => void;
}

const Ctx = createContext<SocketCtx | null>(null);

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8080";

export function SocketProvider({ pubkey, children }: { pubkey: string; children: ReactNode }) {
  const socketRef = useRef<ClientSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [ready, setReady] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [credits, setCredits] = useState(0);
  const [refillTargetAt, setRefillTargetAt] = useState<number | null>(null);
  const [presence, setPresence] = useState<PresenceUpdatePayload>({
    online: 0,
    humans: 0,
    larpers: 0,
  });

  useEffect(() => {
    const socket: ClientSocket = io(SERVER_URL, {
      auth: { pubkey }, // handshake contract; signature reserved (server doesn't verify yet)
      transports: ["websocket"],
      reconnection: true,
    });
    socketRef.current = socket;

    const applyRefill = (ms: number, atCap: boolean) =>
      setRefillTargetAt(atCap ? null : Date.now() + ms);

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.io.on("reconnect_attempt", () => setStatus("reconnecting"));
    socket.io.on("reconnect", () => setStatus("connected"));

    socket.on(SocketEvents.PlayerState, (p: PlayerStatePayload) => {
      setPlayer(p.player);
      setCredits(p.player.credits);
      applyRefill(p.refillCountdownMs, p.player.credits >= MAX_CREDITS);
      setReady(true);
    });

    socket.on(SocketEvents.CreditsUpdated, (c: CreditsUpdatedPayload) => {
      setCredits(c.credits);
      applyRefill(c.refillCountdownMs, c.credits >= MAX_CREDITS);
    });

    socket.on(SocketEvents.PresenceUpdate, (p: PresenceUpdatePayload) => setPresence(p));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [pubkey]);

  const emit = useCallback<SocketCtx["emit"]>((event, ...args) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  const subscribe = useCallback<SocketCtx["subscribe"]>((event, handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    // socket.io typings are strict here; the cast keeps the public API clean
    s.on(event, handler as never);
    return () => {
      s.off(event, handler as never);
    };
  }, []);

  const value = useMemo<SocketCtx>(
    () => ({
      status,
      ready,
      pubkey,
      player,
      credits,
      maxCredits: MAX_CREDITS,
      refillTargetAt,
      presence,
      emit,
      subscribe,
    }),
    [status, ready, pubkey, player, credits, refillTargetAt, presence, emit, subscribe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket(): SocketCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSocket must be used within <SocketProvider>");
  return ctx;
}
