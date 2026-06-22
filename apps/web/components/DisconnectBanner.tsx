"use client";

import { useSocket } from "@/hooks/useSocket";

export function DisconnectBanner() {
  const { status } = useSocket();
  if (status === "connected") return null;
  const msg =
    status === "reconnecting"
      ? "reconnecting… 💀"
      : status === "disconnected"
        ? "lost the server. retrying…"
        : "connecting…";
  return (
    <div className="bg-danger px-3 py-1 text-center text-xs font-bold text-black">{msg}</div>
  );
}
