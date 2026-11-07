import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function useCodeSync(
  roomId: string,
  name: string,
  onCodeReceived: (code: string) => void
) {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState("Disconnected");
  const [participants, setParticipants] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!roomId.trim()) return;

    const socket = io(API_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Connected");
      setError("");

      socket.emit(
        "room:join",
        { roomId: roomId.trim(), name: name.trim() || "Guest" },
        (result: {
          ok: boolean;
          error?: string;
          participants?: Array<{ id: string; name: string }>;
          code?: string;
        }) => {
          if (!result.ok) {
            setError(result.error || "Could not join room.");
            return;
          }

          setParticipants(result.participants || []);

          if (typeof result.code === "string" && result.code.length > 0) {
            onCodeReceived(result.code);
          }
        }
      );
    });

    socket.on("connect_error", () => {
      setStatus("Connection error");
      setError("Cannot connect to CodeSync server on port 3001.");
    });

    socket.on("disconnect", () => setStatus("Disconnected"));

    socket.on(
      "room:participants",
      (list: Array<{ id: string; name: string }>) => {
        setParticipants(list);
      }
    );

    socket.on("code:update", (payload: { code?: string }) => {
      if (typeof payload.code === "string") {
        onCodeReceived(payload.code);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, name, onCodeReceived]);

  function sendCode(code: string) {
    if (socketRef.current?.connected) {
      socketRef.current.emit("code:update", { code });
    }
  }

  return { status, participants, error, sendCode };
}

