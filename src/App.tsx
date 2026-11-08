import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Code2,
  Copy,
  FileCode2,
  FileJson,
  FileText,
  FolderOpen,
  MessageCircle,
  Moon,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Sun,
  Users,
  Video,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  PhoneOff,
  X,
  LockKeyhole,
  UnlockKeyhole,
  LogOut,
  TerminalSquare,
  ChevronDown,
  Check,
  Link2,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

type Participant = { id: string; name: string };
type Dialog = "create" | "join" | null;
type EditMode = "host" | "everyone";
type RoomPermissions = {
  hostId: string;
  editorId: string;
  editMode: EditMode;
  role: "host" | "editor" | "viewer";
  canEdit: boolean;
};
type ChatMessage = { id: string; name: string; message: string };
type FileName = "main.ts" | "README.md" | "package.json";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");
const starterFiles: Record<FileName, string> = {
  "main.ts": `import { createServer } from "http";\n\nconst PORT = 3000;\n\nconst server = createServer((req, res) => {\n  res.writeHead(200, {\n    "Content-Type": "application/json",\n  });\n\n  res.end(JSON.stringify({\n    status: "CodeSync online",\n    message: "Build something together.",\n  }));\n});\n\nserver.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});\n`,
  "README.md": `# CodeSync\n\nA focused workspace for building software together.\n\n## Getting started\n\n1. Create a workspace or join with its room name.\n2. Share the room name with your collaborators.\n3. Collaborate on code and use room chat.\n\n## Collaboration\n\nThe host can lock editing, allow everyone to edit, or give editing control to one participant.\n`,
  "package.json": `{\n  "name": "codesync-project",\n  "version": "1.0.0",\n  "private": true,\n  "scripts": {\n    "start": "node main.js"\n  }\n}\n`,
};

const fileOrder: FileName[] = ["main.ts", "README.md", "package.json"];

function makeRoomCode(value: string) {
  return value.trim().replace(/\s+/g, "-").slice(0, 80);
}

function fileIcon(file: FileName) {
  if (file.endsWith(".md")) return <FileText size={15} />;
  if (file.endsWith(".json")) return <FileJson size={15} />;
  return <FileCode2 size={15} />;
}


function ClassroomPortal({ onBack, displayName }: { onBack: () => void; displayName: string }) {
  const [socket] = useState(() => io(API_URL, { autoConnect: true, reconnection: true, timeout: 10000 }));
  const [mode, setMode] = useState<"teacher" | "student" | null>(null);
  const [className, setClassName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [name, setName] = useState(displayName);
  const [classroom, setClassroom] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [runOutput, setRunOutput] = useState("Ready. Select JavaScript to run code.");
  const [topic, setTopic] = useState("");
  const [noteText, setNoteText] = useState("");
  const [highlighted, setHighlighted] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [status, setStatus] = useState("learning");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onTeacherState = (state: any) => {
      setClassroom(state);
      setStudents(state.students || []);
    };
    const onStudentState = (state: any) => {
      setClassroom(state);
      setCode(state.code || "");
      setNotes(state.notes || []);
      setStatus(state.status || "learning");
    };
    const onStudentCode = (student: any) => {
      setStudents((previous) => previous.map((item) =>
        item.id === student.id ? { ...item, code: student.code } : item
      ));
    };
    const onStudentStatus = (student: any) => {
      setStudents((previous) => previous.map((item) =>
        item.id === student.id ? { ...item, status: student.status } : item
      ));
    };
    const onPublished = (data: any) => {
      setCode(data.code || "");
      setMessage("Teacher published a new code copy.");
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", (error) => {
      setMessage("Socket connection failed: " + error.message);
    });
    socket.on("disconnect", onDisconnect);
    socket.on("classroom:teacher:state", onTeacherState);
    socket.on("classroom:student:state", onStudentState);
    socket.on("classroom:student:code", onStudentCode);
    socket.on("classroom:student:status", onStudentStatus);
    socket.on("classroom:student:published", onPublished);

    // Explicitly connect whenever this effect is set up.
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("classroom:teacher:state", onTeacherState);
      socket.off("classroom:student:state", onStudentState);
      socket.off("classroom:student:code", onStudentCode);
      socket.off("classroom:student:status", onStudentStatus);
      socket.off("classroom:student:published", onPublished);
      socket.disconnect();
    };
  }, [socket]);

  function createClass() {
    if (!socket.connected) {
      setMessage("Classroom server is not connected. Wait a few seconds and try again.");
      return;
    }

    if (!className.trim()) {
      setMessage("Enter a classroom name first.");
      return;
    }

    setMessage("Creating classroom...");

    socket.timeout(5000).emit("classroom:create", {
      name: className.trim(),
      teacherName: name.trim() || "Teacher",
      initialCode: "function greet(name: string) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet(\"Class\"));",
    }, (error: Error | null, result: any) => {
      if (error) {
        setMessage("The server did not respond to classroom creation. Check the backend terminal.");
        return;
      }

      if (!result?.ok) {
        setMessage(result?.error || "Could not create classroom.");
        return;
      }

      setMode("teacher");
      setClassroom(result.classroom);
      setCode(result.classroom?.teacherCode || "");
      setMessage("Classroom created. Invitation code: " + result.classroom.inviteCode);
    });
  }

  function joinClass() {
    socket.emit("classroom:join", {
      inviteCode,
      studentName: name,
    }, (result: any) => {
      if (!result?.ok) {
        setMessage(result?.error || "Could not join classroom.");
        return;
      }
      setMode("student");
      setClassroom(result.classroom);
      setCode(result.classroom?.code || "");
      setNotes(result.classroom?.notes || []);
      setMessage("You joined the classroom.");
    });
  }

  function updateCode(value: string) {
    setCode(value);
    socket.emit(mode === "teacher" ? "classroom:teacher:code:update" : "classroom:student:code:update", { code: value });
  }

  function saveNote() {
    socket.emit("classroom:notes:save", {
      topic,
      text: noteText,
      highlighted,
    }, (result: any) => {
      if (!result?.ok) {
        setMessage(result?.error || "Could not save note.");
        return;
      }
      setTopic("");
      setNoteText("");
      setHighlighted(false);
      setMessage("Private note saved.");
    });
  }

  const panelStyle: React.CSSProperties = {
    background: "var(--panel, #171923)",
    border: "1px solid #343746",
    borderRadius: 12,
    padding: 18,
    color: "inherit",
  };
  const buttonStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #626b84",
    cursor: "pointer",
    margin: "4px",
  };

  return (
    <main className="app dark" style={{ minHeight: "100vh", padding: 24, color: "#f3f4f8" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <button style={buttonStyle} onClick={onBack}>? CodeSync home</button>
        <h1 style={{ margin: 0 }}>CodeSync Classroom</h1>
        <span>{connected ? "? Connected" : "? Connecting..."}</span>
      </header>

      {!mode && (
        <section style={{ ...panelStyle, maxWidth: 600, margin: "30px auto" }}>
          <h2>Create or join a class</h2>
          <label style={{ display: "block", margin: "12px 0 4px" }}>Your name</label>
          <input style={{ ...buttonStyle, width: "95%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <hr style={{ borderColor: "#343746", margin: "20px 0" }} />
          <h3>Teacher: create classroom</h3>
          <input style={{ ...buttonStyle, width: "95%" }} value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Classroom name" />
          <button style={buttonStyle} onClick={createClass}>Create classroom</button>
          <hr style={{ borderColor: "#343746", margin: "20px 0" }} />
          <h3>Student: join classroom</h3>
          <input style={{ ...buttonStyle, width: "95%" }} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Invitation code" />
          <button style={buttonStyle} onClick={joinClass}>Join classroom</button>
        </section>
      )}

      {mode && classroom && (
        <>
          <section style={{ ...panelStyle, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>{classroom.name}</h2>
            <p>{mode === "teacher" ? "Teacher dashboard - Student code is read-only here." : `Teacher: ${classroom.teacherName}`}</p>
            {mode === "teacher" && <h3>Invitation code: <code>{classroom.inviteCode}</code></h3>}
            {mode === "teacher" && <button style={buttonStyle} onClick={() => {
              socket.emit("classroom:publish", {}, (result: any) => setMessage(result?.ok ? "Code published to students." : result?.error || "Publish failed."));
            }}>Publish my code to students</button>}
            {mode === "student" && <>
              <label>Status </label>
              <select style={buttonStyle} value={status} onChange={(e) => {
                const next = e.target.value;
                setStatus(next);
                socket.emit("classroom:student:status", { status: next });
              }}>
                <option value="learning">Learning</option>
                <option value="working">Working</option>
                <option value="needs-help">Need help</option>
              </select>
            </>}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <section style={panelStyle}>
              <h3>{mode === "teacher" ? "Teacher's private code" : "My independent code"}</h3>
              <label htmlFor="classroom-language">Language: </label>
              <select id="classroom-language" style={buttonStyle} value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
              </select>
              <Editor
                height="320px"
                language={language}
                theme="vs-dark"
                value={code}
                onChange={(value) => updateCode(value ?? "")}
                options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false }}
              />
              <div style={{ marginTop: 12, border: "1px solid #343746", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#171a22" }}>
                  <strong>Terminal / Output</strong>
                  <button style={buttonStyle} onClick={async () => {
                    if (language === "python" || language === "java") {
                      setRunOutput("Running " + language + "...");
                      try {
                        const response = await fetch(`${API_URL}/api/execute`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ language, code, stdin: "" })
                        });
                        const result = await response.json();
                        if (!response.ok) {
                          setRunOutput("Execution error: " + (result.error || response.statusText));
                          return;
                        }
                        const output = [
                          result.compile?.stderr,
                          result.compile?.stdout,
                          result.run?.stdout,
                          result.run?.stderr,
                          result.run?.signal ? "Signal: " + result.run.signal : "",
                          result.run?.code !== 0 && result.run?.code != null ? "Exit code: " + result.run.code : ""
                        ].filter(Boolean).join("\n");
                        setRunOutput(output || (result.success ? "(No output)" : "Execution failed."));
                      } catch (error) {
                        setRunOutput("Could not connect to CodeSync execution server. Check port 3001.");
                      }
                      return;
                    }
                    if (language !== "javascript") {
                      setRunOutput("This language is not supported yet.");
                      return;
                    }
                    setRunOutput("Running JavaScript...");
                    const workerSource = `self.onmessage = function(event) {
                      const lines = [];
                      console.log = (...args) => lines.push(args.map(value => {
                        try { return typeof value === "string" ? value : JSON.stringify(value); }
                        catch { return String(value); }
                      }).join(" "));
                      try {
                        new Function(event.data)();
                        self.postMessage({ output: lines.join("\\n") || "(No output)" });
                      } catch (error) {
                        self.postMessage({ output: "Error: " + (error && error.message ? error.message : String(error)) });
                      }
                    };`;
                    const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
                    const worker = new Worker(blobUrl);
                    let finished = false;
                    const timer = window.setTimeout(() => {
                      if (finished) return;
                      finished = true;
                      worker.terminate();
                      URL.revokeObjectURL(blobUrl);
                      setRunOutput("Stopped: execution exceeded 2 seconds.");
                    }, 2000);
                    worker.onmessage = (event) => {
                      if (finished) return;
                      finished = true;
                      window.clearTimeout(timer);
                      worker.terminate();
                      URL.revokeObjectURL(blobUrl);
                      setRunOutput(event.data.output);
                    };
                    worker.onerror = () => {
                      if (finished) return;
                      finished = true;
                      window.clearTimeout(timer);
                      worker.terminate();
                      URL.revokeObjectURL(blobUrl);
                      setRunOutput("JavaScript worker error.");
                    };
                    worker.postMessage(code);
                  }}>Run</button>
                </div>
                <pre style={{ margin: 0, padding: 12, minHeight: 90, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#0d1018", color: "#d9f7c7" }}>{runOutput}</pre>
              </div>
              {mode === "student" && <p>Only your own code is editable. Teacher code is published as a separate copy.</p>}
            </section>

            {mode === "teacher" ? (
              <section style={panelStyle}>
                <h3>Students - {students.length}</h3>
                {students.length === 0 && <p>No students have joined yet.</p>}
                {students.map((student) => (
                  <article key={student.id} style={{ border: "1px solid #343746", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                    <strong>{student.name}</strong>
                    <p>Status: {student.status}</p>
                    <button style={buttonStyle} onClick={() => setSelectedStudent(student)}>Monitor code</button>
                    {selectedStudent?.id === student.id && <textarea readOnly value={student.code || ""} style={{ width: "100%", minHeight: 180, boxSizing: "border-box", background: "#0d1018", color: "#d9f7c7", padding: 10 }} />}
                  </article>
                ))}
              </section>
            ) : (
              <section style={panelStyle}>
                <h3>My private notes</h3>
                <input style={{ ...buttonStyle, width: "95%" }} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (e.g. loops, functions, React hooks)" />
                <textarea style={{ width: "100%", minHeight: 100, boxSizing: "border-box", margin: "8px 0", padding: 10 }} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note..." />
                <label style={{ display: "block", marginBottom: 10 }}><input type="checkbox" checked={highlighted} onChange={(e) => setHighlighted(e.target.checked)} /> Highlight this note</label>
                <button style={buttonStyle} onClick={saveNote}>Save note</button>
                {notes.map((note) => (
                  <article key={note.id} style={{ border: "1px solid #343746", borderRadius: 8, padding: 12, marginTop: 10, background: note.highlighted ? "#493f1f" : "transparent" }}>
                    <strong>{note.topic}</strong>
                    <p style={{ whiteSpace: "pre-wrap" }}>{note.text}</p>
                    <small>Created: {new Date(note.createdAt).toLocaleString()} - Updated: {new Date(note.updatedAt).toLocaleString()}</small>
                    <button style={buttonStyle} onClick={() => socket.emit("classroom:notes:delete", { id: note.id }, (result: any) => setMessage(result?.ok ? "Note deleted." : result?.error || "Delete failed."))}>Delete</button>
                  </article>
                ))}
              </section>
            )}
          </div>
        </>
      )}
      {message && <p role="status" style={{ marginTop: 16 }}>{message}</p>}
    </main>
  );
}

function VideoTile({ stream, muted, label }: { stream: MediaStream | null; muted?: boolean; label: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="video-tile">
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      ) : (
        <div className="video-placeholder"><Video size={28} /><span>Camera unavailable</span></div>
      )}
      <span className="video-tile-label">{label}</span>
    </div>
  );
}

export default function App() {
  const [showClassroom, setShowClassroom] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [projectName, setProjectName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [displayName, setDisplayName] = useState(() => localStorage.getItem("codesync-name") || "Guest");
  const [workspace, setWorkspace] = useState("");
  const [activeFile, setActiveFile] = useState<FileName>("main.ts");
  const [fileContents, setFileContents] = useState<Record<FileName, string>>(starterFiles);
  const [dark, setDark] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [roomLanguage, setRoomLanguage] = useState("python");
  const [, setRoomRunOutput] = useState("Choose a language and click Run.");
  const [roomRunning, setRoomRunning] = useState(false);
  const [, setTerminalOutput] = useState("CodeSync terminal.");
  const [terminalStatus, setTerminalStatus] = useState("Not started");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [permissions, setPermissions] = useState<RoomPermissions | null>(null);
  const [mySocketId, setMySocketId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const pyodideRef = useRef<any>(null);
  const currentCodeRef = useRef(fileContents["main.ts"]);
  const currentFileRef = useRef<FileName>("main.ts");
  const latestFilesRef = useRef(fileContents);

  const [callJoined, setCallJoined] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [callConnecting, setCallConnecting] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [callError, setCallError] = useState("");

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const screenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    latestFilesRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    currentCodeRef.current = fileContents[activeFile];
    currentFileRef.current = activeFile;
  }, [activeFile, fileContents]);

  useEffect(() => {
    const element = terminalElementRef.current;
    if (!terminalOpen || !element) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 13,
      fontFamily: "Consolas, monospace",
      scrollback: 3000,
      theme: { background: "#0b0d12", foreground: "#e6edf3", cursor: "#e6edf3" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    fitAddon.fit();
    terminalInstanceRef.current = terminal;
    terminal.writeln("CodeSync interactive terminal");
    const inputSubscription = terminal.onData((data) => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      socket.emit("terminal:input", { data }, (result: { ok: boolean; error?: string }) => {
        if (!result?.ok) terminal.write("\r\n" + (result?.error || "Terminal input was rejected.") + "\r\n");
      });
    });
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      inputSubscription.dispose();
      terminal.dispose();
      if (terminalInstanceRef.current === terminal) terminalInstanceRef.current = null;
    };
  }, [terminalOpen]);

  const applyIncomingCode = useCallback((incoming: string) => {
    if (incoming === currentCodeRef.current) return;
    currentCodeRef.current = incoming;
    const file = currentFileRef.current;
    setFileContents((previous) => ({ ...previous, [file]: incoming }));
  }, []);

  function createPeerConnection(peerId: string) {
    const existing = peerConnectionsRef.current.get(peerId);
    if (existing) return existing;

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("call:ice-candidate", {
          targetId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    peer.ontrack = (event) => {
      const incomingStream = event.streams[0];
      if (incomingStream) {
        setRemoteStreams((previous) => ({
          ...previous,
          [peerId]: incomingStream,
        }));
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        peer.close();
        peerConnectionsRef.current.delete(peerId);
        pendingCandidatesRef.current.delete(peerId);
        setRemoteStreams((previous) => {
          const next = { ...previous };
          delete next[peerId];
          return next;
        });
      }
    };

    peerConnectionsRef.current.set(peerId, peer);
    return peer;
  }

  async function flushPendingCandidates(peerId: string, peer: RTCPeerConnection) {
    const pending = pendingCandidatesRef.current.get(peerId) || [];
    pendingCandidatesRef.current.delete(peerId);

    for (const candidate of pending) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Could not add queued ICE candidate:", error);
      }
    }
  }

  async function sendCallOffer(peerId: string) {
    try {
      const peer = createPeerConnection(peerId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socketRef.current?.emit("call:offer", {
        targetId: peerId,
        description: peer.localDescription,
      });
    } catch (error) {
      console.error("Could not create call offer:", error);
      setCallError("Could not connect to another participant.");
    }
  }

  async function joinCall() {
    const socket = socketRef.current;

    if (!socket?.connected) {
      setCallError("Connect to the room before starting a call.");
      return;
    }
    if (callJoined || callConnecting) return;

    setCallConnecting(true);
    setCallError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicEnabled(true);
      setCameraEnabled(true);

      socket.emit("call:join");
      setCallJoined(true);
    } catch (error) {
      console.error("Could not access microphone or camera:", error);
      setCallError(
        "Could not access your microphone and camera. Check browser permissions and try again.",
      );
    } finally {
      setCallConnecting(false);
    }
  }

  function leaveCall() {
    socketRef.current?.emit("call:leave");

    peerConnectionsRef.current.forEach((peer) => peer.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();

    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    setLocalStream(null);
    setRemoteStreams({});
    setCallJoined(false);
    setCallConnecting(false);
    setMicEnabled(true);
    setCameraEnabled(true);
    setCallError("");
  }

  function toggleMicrophone() {
    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  }

  function toggleCamera() {
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  }

  useEffect(() => {
    if (!workspace) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnectionStatus("Disconnected");
      setParticipants([]);
      setPermissions(null);
      setMySocketId("");
      return;
    }

    const socket = io(API_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 5000,
    });
    socketRef.current = socket;
    setConnectionStatus("Connecting...");

    socket.on("connect", () => {
      setMySocketId(socket.id || "");
      setConnectionStatus("Joining room");
      socket.emit(
        "room:join",
        { roomId: workspace, name: displayName.trim() || "Guest" },
        (result: {
          ok: boolean;
          error?: string;
          participants?: Participant[];
          code?: string;
        }) => {
          if (!result?.ok) {
            setConnectionStatus("Join failed");
            setNotice(result?.error || "Unable to join this room.");
            return;
          }
          setConnectionStatus("Connected");
          setParticipants(result.participants || []);
          if (typeof result.code === "string" && result.code.length > 0) {
            applyIncomingCode(result.code);
          } else {
            // Seed a newly created in-memory room with the current file's contents.
            socket.emit("code:update", { code: latestFilesRef.current[currentFileRef.current] });
          }
        },
      );
    });

    socket.on("connect_error", () => {
      setConnectionStatus("Connection error");
      setNotice("Could not connect to the CodeSync server. Check that the backend is running on port 3001.");
    });
    socket.on("disconnect", () => setConnectionStatus("Disconnected"));
    socket.on("room:participants", (list: Participant[]) => setParticipants(list));
    socket.on("room:permissions", (next: RoomPermissions) => setPermissions(next));
    socket.on("code:update", (payload: { code?: string; file?: FileName }) => {
      if (typeof payload?.code === "string") applyIncomingCode(payload.code);
    });
    socket.on("code:update:rejected", (payload: { reason?: string }) => {
      setNotice(payload?.reason || "You do not have editing control.");
    });
    socket.on("chat:message", (message: ChatMessage) => {
      setChatMessages((previous) => [...previous, message].slice(-100));
    });

    socket.on("terminal:output", (data: string) => {
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.write(data);
      } else {
        setTerminalOutput((previous) => (previous + data).slice(-30000));
      }
    });
    socket.on("terminal:status", (status: string) => {
      setTerminalStatus(status);
    });
    socket.on("terminal:error", (message: string) => {
      setTerminalStatus("Error");
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.write("\r\n" + message + "\r\n");
      } else {
        setTerminalOutput((previous) => (previous + "\n" + message + "\n").slice(-30000));
      }
    });
    socket.on("call:user-joined", (payload: { id: string }) => {
      if (payload?.id && payload.id !== socket.id) {
        void sendCallOffer(payload.id);
      }
    });

    socket.on("call:offer", async (payload: {
      from: string;
      description: RTCSessionDescriptionInit;
    }) => {
      if (!payload?.from || !payload.description) return;

      try {
        const peer = createPeerConnection(payload.from);
        await peer.setRemoteDescription(new RTCSessionDescription(payload.description));
        await flushPendingCandidates(payload.from, peer);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("call:answer", {
          targetId: payload.from,
          description: peer.localDescription,
        });
      } catch (error) {
        console.error("Could not handle call offer:", error);
        setCallError("Could not answer an incoming call.");
      }
    });

    socket.on("call:answer", async (payload: {
      from: string;
      description: RTCSessionDescriptionInit;
    }) => {
      if (!payload?.from || !payload.description) return;

      try {
        const peer = peerConnectionsRef.current.get(payload.from);
        if (!peer) return;

        await peer.setRemoteDescription(new RTCSessionDescription(payload.description));
        await flushPendingCandidates(payload.from, peer);
      } catch (error) {
        console.error("Could not handle call answer:", error);
        setCallError("Could not complete the call connection.");
      }
    });

    socket.on("call:ice-candidate", async (payload: {
      from: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (!payload?.from || !payload.candidate) return;

      const peer = peerConnectionsRef.current.get(payload.from);

      if (!peer || !peer.remoteDescription) {
        const pending = pendingCandidatesRef.current.get(payload.from) || [];
        pending.push(payload.candidate);
        pendingCandidatesRef.current.set(payload.from, pending);
        return;
      }

      try {
        await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (error) {
        console.error("Could not add ICE candidate:", error);
      }
    });

    socket.on("call:peer-left", (payload: { id: string }) => {
      if (!payload?.id) return;

      peerConnectionsRef.current.get(payload.id)?.close();
      peerConnectionsRef.current.delete(payload.id);
      pendingCandidatesRef.current.delete(payload.id);

      setRemoteStreams((previous) => {
        const next = { ...previous };
        delete next[payload.id];
        return next;
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [workspace, displayName, applyIncomingCode]);

  const code = fileContents[activeFile];
  function startRoomTerminal() {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setTerminalStatus("Disconnected");
      setTerminalOutput((previous) => previous + "\nNot connected to the room server.\n");
      return;
    }

    setTerminalOpen(true);
    setTerminalStatus("Starting...");
    socket.emit("terminal:start", {}, (result: { ok: boolean; error?: string; message?: string }) => {
      if (!result?.ok) {
        setTerminalStatus("Failed to start");
        setTerminalOutput((previous) => previous + "\n" + (result?.error || "Terminal could not start.") + "\n");
        return;
      }
      setTerminalStatus("Running");
      if (result.message) setTerminalOutput((previous) => previous + "\n" + result.message + "\n");
    });
  }

  function stopRoomTerminal() {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit("terminal:stop", {}, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) {
        setTerminalOutput((previous) => previous + "\n" + (result?.error || "Could not stop terminal.") + "\n");
        return;
      }
      setTerminalStatus("Stopped");
    });
  }

  async function runRoomCode() {
    if (roomRunning) return;
    setTerminalOpen(true);
    setRoomRunning(true);
    setRoomRunOutput("Running " + roomLanguage + "...");

    if (roomLanguage === "python" && !API_URL.includes("localhost") && !API_URL.includes("127.0.0.1")) {
      try {
        const pyodideWindow = window as Window & { loadPyodide?: (options: { indexURL: string }) => Promise<any> };
        if (!pyodideRef.current) {
          if (!pyodideWindow.loadPyodide) throw new Error("Python runtime is not loaded. Refresh and try again.");
          pyodideRef.current = await pyodideWindow.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/" });
        }
        let output = "";
        pyodideRef.current.setStdout({ batched: (text: string) => { output += text + "\n"; } });
        pyodideRef.current.setStderr({ batched: (text: string) => { output += text + "\n"; } });
        await pyodideRef.current.runPythonAsync(code);
        const runOutput = output.trimEnd() || "(No output)";
        setRoomRunOutput(runOutput);
        if (terminalInstanceRef.current) terminalInstanceRef.current.writeln(runOutput);
        else setTerminalOutput((previous) => (previous + "\n" + runOutput + "\n").slice(-30000));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Python execution failed.";
        setRoomRunOutput(message);
        setTerminalOutput((previous) => (previous + "\n" + message + "\n").slice(-30000));
      } finally {
        setRoomRunning(false);
      }
      return;
    }

    if (roomLanguage === "python") {
      const socket = socketRef.current;

      if (!socket?.connected) {
        setRoomRunOutput("Not connected to the CodeSync server.");
        setRoomRunning(false);
        return;
      }

      const bytes = new TextEncoder().encode(code);
      let binary = "";

      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }

      const codeBase64 = btoa(binary);

      socket.emit(
        "terminal:run",
        { language: "python", codeBase64 },
        (result: { ok: boolean; error?: string }) => {
          if (!result?.ok) {
            const message = result?.error || "Python execution failed.";
            setRoomRunOutput(message);
            setTerminalOutput((previous) => (previous + "\n" + message + "\n").slice(-30000));
          } else {
            setRoomRunOutput("Python is running in the interactive terminal. Enter input below when prompted.");
          }

          setRoomRunning(false);
        },
      );

      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: roomLanguage, code, stdin: "" }),
      });
      const result = await response.json();

      if (!response.ok) {
        setRoomRunOutput("Execution error: " + (result.error || response.statusText));
        return;
      }

      const output = [
        result.compile?.stderr,
        result.compile?.stdout,
        result.run?.stdout,
        result.run?.stderr,
        result.run?.signal ? "Signal: " + result.run.signal : "",
        result.run?.code !== 0 && result.run?.code != null ? "Exit code: " + result.run.code : "",
      ].filter(Boolean).join("\n");

      const runOutput = output || (result.success ? "(No output)" : "Execution failed.");
      setRoomRunOutput(runOutput);

      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.writeln("");
        terminalInstanceRef.current.writeln(runOutput);
      } else {
        setTerminalOutput((previous) => (previous + "\n\n" + runOutput + "\n").slice(-30000));
      }
    } catch {
      setRoomRunOutput("Could not connect to CodeSync execution server on port 3001.");
    } finally {
      setRoomRunning(false);
    }
  }
  const visibleFiles = useMemo(
    () => fileOrder.filter((file) => file.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  function updateCode(nextCode: string) {
    if (!permissions?.canEdit) {
      setNotice("You have view-only access. Ask the host to give you editing control.");
      return;
    }
    currentCodeRef.current = nextCode;
    setFileContents((previous) => ({ ...previous, [activeFile]: nextCode }));
    socketRef.current?.emit("code:update", { code: nextCode, file: activeFile });
  }

  function openWorkspace(name: string) {
    const cleanName = makeRoomCode(name);
    if (!cleanName) {
      setNotice("Enter a workspace name first.");
      return;
    }
    localStorage.setItem("codesync-name", displayName.trim() || "Guest");
    setWorkspace(cleanName);
    setDialog(null);
    setNotice("");
    setActiveFile("main.ts");
    setFileContents(starterFiles);
    currentCodeRef.current = starterFiles["main.ts"];
    currentFileRef.current = "main.ts";
    setChatMessages([]);
  }

  function selectFile(file: FileName) {
    setActiveFile(file);
    currentFileRef.current = file;
    currentCodeRef.current = fileContents[file];
    // The current backend synchronizes one shared text buffer per room, not separate files.
    // File selection therefore changes the local starter-file view; edits to the selected file sync as text.
    if (permissions?.canEdit) socketRef.current?.emit("code:update", { code: fileContents[file], file });
  }

  function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    if (!socketRef.current?.connected) {
      setNotice("Connect to the room before sending a message.");
      return;
    }
    socketRef.current.emit("chat:send", { message });
    setChatInput("");
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(workspace);
      setNotice("Room name copied to clipboard.");
    } catch {
      setNotice(`Room name: ${workspace}`);
    }
  }

  function leaveWorkspace() {
    setWorkspace("");
    setPermissions(null);
    setParticipants([]);
    setChatMessages([]);
    setNotice("");
  }

  function setEditMode(mode: EditMode) {
    socketRef.current?.emit("room:control:set", { mode });
  }

  function giveControl(participantId: string) {
    socketRef.current?.emit("room:control:set", { editorId: participantId });
  }

  function takeControlBack() {
    socketRef.current?.emit("room:control:set", { editorId: permissions?.hostId });
  }

  function renderLanding() {
    return (
      <main className={dark ? "app dark landing-app" : "app light landing-app"}>
        <header className="topbar landing-topbar">
          <button className="brand" onClick={() => setDialog(null)} aria-label="CodeSync home">
            <span className="brand-mark">C</span><span>codesync<span className="accent-dot">.</span></span>
          </button>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setDark((value) => !value)} title="Toggle theme">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="secondary-button" onClick={() => setDialog("join")}>Join workspace</button>
            <button className="primary-button" onClick={() => setDialog("create")}><Plus size={16} /> Create workspace</button>
          </div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="status-dot" /> REAL-TIME COLLABORATION FOR DEVELOPERS</div>
            <h1>Build better code.<br /><span>Together.</span></h1>
            <p className="hero-description">A shared coding room for teaching, pair programming, and technical interviews. Stay focused on the code.</p>
            <div className="hero-actions">
              <button className="primary-button large" onClick={() => setDialog("create")}>Start a workspace <span>?</span></button>
              <button className="secondary-button large" onClick={() => setDialog("join")}>Join a room</button>
              <button className="primary-button large" onClick={() => setShowClassroom(true)}><Users size={16} /> Classroom</button>
            </div>
            <div className="hero-trust"><span><Users size={15} /> Shared workspace</span><span><Shield size={15} /> Host-controlled editing</span><span><MessageCircle size={15} /> Built-in chat</span></div>
          </div>
          <div className="hero-preview">
            <div className="preview-window">
              <div className="preview-top"><span className="window-dots"><i /><i /><i /></span><span>codesync / main.ts</span><span className="preview-live"><i /> LIVE</span></div>
              <div className="preview-code">
                <span className="ln">01</span><span><b>function</b> <em>buildTogether</em>() {'{'}</span>
                <span className="ln">02</span><span>&nbsp;&nbsp;<b>const</b> ideas = <strong>["learn", "build"]</strong>;</span>
                <span className="ln">03</span><span>&nbsp;&nbsp;<b>return</b> ideas.<em>map</em>((idea) =&gt; {'{'}</span>
                <span className="ln">04</span><span>&nbsp;&nbsp;&nbsp;&nbsp;<b>share</b>(idea);</span>
                <span className="ln">05</span><span>&nbsp;&nbsp;{'}'});</span>
                <span className="ln">06</span><span>{'}'}</span>
              </div>
              <div className="preview-bottom"><span><i className="status-dot" /> 2 collaborators online</span><span>TypeScript</span></div>
            </div>
            <div className="preview-note"><span className="note-avatar">D</span><span><b>Dee</b><small>is reviewing the code</small></span><span className="note-check"><Check size={14} /></span></div>
          </div>
        </section>

        <section className="feature-grid">
          <article className="feature-card"><span className="feature-icon"><Code2 size={19} /></span><h3>One shared workspace</h3><p>Keep code, files, and collaborators in one focused room.</p></article>
          <article className="feature-card"><span className="feature-icon"><LockKeyhole size={19} /></span><h3>Host-controlled editing</h3><p>Lock the editor or hand control to a candidate or student.</p></article>
          <article className="feature-card"><span className="feature-icon"><MessageCircle size={19} /></span><h3>Talk through ideas</h3><p>Use room chat to ask questions and explain your thinking.</p></article>
        </section>

        {dialog && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
            <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
              <button className="icon-button dialog-close" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={17} /></button>
              <div className="dialog-symbol">{dialog === "create" ? <Plus size={21} /> : <Link2 size={21} />}</div>
              <h2 id="dialog-title">{dialog === "create" ? "Create a workspace" : "Join a workspace"}</h2>
              <p>{dialog === "create" ? "Choose a room name and invite your collaborators." : "Enter the room name shared by your host."}</p>
              <form onSubmit={(event) => { event.preventDefault(); openWorkspace(dialog === "create" ? projectName : roomCode); }}>
                <label htmlFor="display-name">Your display name</label>
                <input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Alex" maxLength={40} />
                <label htmlFor="room-name">{dialog === "create" ? "Workspace name" : "Room name"}</label>
                <input id="room-name" autoFocus value={dialog === "create" ? projectName : roomCode} onChange={(event) => dialog === "create" ? setProjectName(event.target.value) : setRoomCode(event.target.value)} placeholder={dialog === "create" ? "e.g. frontend-interview" : "Enter room name"} maxLength={80} required />
                {notice && <p className="notice-text">{notice}</p>}
                <button className="primary-button full" type="submit">{dialog === "create" ? "Create workspace" : "Join workspace"} <span>?</span></button>
              </form>
              <button className="dialog-switch" onClick={() => { setDialog(dialog === "create" ? "join" : "create"); setNotice(""); }}>{dialog === "create" ? "Already have a room? Join it" : "Need a new room? Create one"}</button>
            </section>
          </div>
        )}
      </main>
    );
  }

  if (!workspace && showClassroom) {
    return <ClassroomPortal onBack={() => setShowClassroom(false)} displayName={displayName} />;
  }

  if (!workspace) return renderLanding();

  return (
    <main className={dark ? "app dark" : "app light"}>
      <header className="topbar">
        <button className="brand" onClick={leaveWorkspace} aria-label="Back to CodeSync home"><span className="brand-mark">C</span><span>codesync<span className="accent-dot">.</span></span></button>
        <div className="workspace-title">
          <span className="status-dot" style={{ background: connectionStatus === "Connected" ? "#b8f36b" : "#e6b45c" }} />
          <strong>{workspace}</strong>
          <span className="local-label">{connectionStatus.toUpperCase()}</span>
          <span className="local-label">{participants.length} ONLINE</span>
          <span className="local-label">{permissions?.role === "host" ? "HOST" : permissions?.canEdit ? "CAN EDIT" : "VIEW ONLY"}</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setDark((value) => !value)} title="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="secondary-button" onClick={copyRoomCode}><Copy size={14} /> Copy room name</button>
          <button className="primary-button" onClick={() => setNotice("Share this room name with your collaborator: " + workspace)}><Users size={15} /> Invite</button>
          <button className="icon-button" onClick={leaveWorkspace} title="Leave workspace"><LogOut size={16} /></button>
        </div>
      </header>

      <div className="ide-layout">
        <aside className="activity-bar">
          <button className="activity active" title="Explorer" onClick={() => { setSearchOpen(false); setChatOpen(false); }}><FolderOpen size={18} /></button>
          <button className={`activity ${searchOpen ? "active" : ""}`} title="Search files" onClick={() => setSearchOpen((value) => !value)}><Search size={18} /></button>
          <button className={`activity ${chatOpen ? "active" : ""}`} title="Chat" onClick={() => setChatOpen((value) => !value)}><MessageCircle size={18} /></button>
          <div className="activity-bottom">
            <button className="activity" title="Settings" onClick={() => setNotice("Settings: display name can be changed by leaving and rejoining the room.")}><Settings size={18} /></button>
          </div>
        </aside>

        <aside className="file-sidebar">
          <div className="sidebar-heading"><span>EXPLORER</span><button className="icon-button small" title="New file" onClick={() => setNotice("Custom file creation will be added with multi-file server sync.")}><Plus size={14} /></button></div>
          <div className="project-folder"><ChevronDown size={14} /> {workspace.toUpperCase()}</div>
          {searchOpen && <div className="file-search"><Search size={13} /><input aria-label="Search files" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter files..." /></div>}
          {visibleFiles.map((file) => (
            <button className={`file-row ${activeFile === file ? "selected" : ""}`} key={file} onClick={() => selectFile(file)}>
              <span className={`file-icon ${file.endsWith(".md") ? "md" : file.endsWith(".json") ? "json" : "ts"}`}>{fileIcon(file)}</span>{file}
            </button>
          ))}
          <div className="sidebar-footer"><span className="status-dot" style={{ background: connectionStatus === "Connected" ? "#b8f36b" : "#e6b45c" }} />{connectionStatus}</div>
        </aside>

        <section className="editor-area">
          <div className="tab-strip">
            <div className="editor-tab"><span className="file-icon ts">{fileIcon(activeFile)}</span>{activeFile}<span className="tab-close" /></div>
            <span className="tab-spacer" />
            <button className="icon-button small" title="Editor options" onClick={() => setNotice("Editor settings are coming soon.")}>?</button>
          </div>
          <div className="breadcrumbs">{workspace} / {activeFile}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border, #333)" }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>LANGUAGE</span>
            <select aria-label="Workspace code language" value={roomLanguage} onChange={(event) => setRoomLanguage(event.target.value)} style={{ padding: "7px 10px", borderRadius: 6, background: "var(--panel, #222)", color: "inherit" }}>
              <option value="python">Python</option>
              <option value="java">Java</option>
            </select>
            <button onClick={runRoomCode} disabled={roomRunning || !permissions?.canEdit} style={{ padding: "7px 16px", borderRadius: 6, cursor: "pointer" }}>
              <Play size={14} /> {roomRunning ? "Running..." : "Run"}
            </button>
          </div>          <div className="editor-content">
            <Editor
              height="100%"
              language={activeFile === "README.md" ? "markdown" : activeFile === "package.json" ? "json" : roomLanguage}
              theme={dark ? "vs-dark" : "light"}
              value={code}
              onChange={(value) => updateCode(value ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: !permissions?.canEdit,
                wordWrap: "off",
                tabSize: roomLanguage === "python" ? 4 : 2,
                insertSpaces: true,
                detectIndentation: false,
                autoIndent: "full",
              }}
            />
          </div>
          <div className={`terminal ${terminalOpen ? "expanded" : ""}`}>
            <div className="terminal-heading">
              <div className="terminal-tabs"><button className="terminal-tab active" onClick={() => setTerminalOpen((value) => !value)}><TerminalSquare size={13} /> TERMINAL</button><button className="terminal-tab" onClick={() => setNotice("No problem reports available.")}>PROBLEMS</button><button className="terminal-tab" onClick={() => setTerminalOpen(true)}>OUTPUT</button></div>
              <button className="icon-button small" onClick={() => setTerminalOpen((value) => !value)}>{terminalOpen ? "?" : "^"}</button>
            </div>
            {terminalOpen && <div className="terminal-body">
  <div className="terminal-controls">
    <span className="terminal-muted">Shell: {terminalStatus}</span>
    <button type="button" onClick={startRoomTerminal}>Start</button>
    <button type="button" onClick={stopRoomTerminal}>Stop</button>
  </div>
  <div className="terminal-muted">Room server: {connectionStatus} | Participants: {participants.length}</div>
  <div ref={terminalElementRef} className="terminal-xterm" aria-label="Interactive terminal" />
</div>}
          </div>
          <footer className="editor-status"><span><Code2 size={13} /> {activeFile === "README.md" ? "Markdown" : activeFile === "package.json" ? "JSON" : "TypeScript"}</span><span>UTF-8</span><span>LF</span><span>{permissions?.canEdit ? "Editable" : "Read only"}</span><span>{connectionStatus}</span></footer>
        </section>

        <aside className="right-panel">
          <div className="panel-heading">COLLABORATION</div>
          <div className="collab-card">
            <div className="collab-symbol"><Users size={17} /></div><h3>Workspace members</h3>
            <p>{connectionStatus === "Connected" ? "People connected to this room." : "Waiting for the backend connection."}</p>
            {participants.map((participant) => (
              <div className="detail-row participant-row" key={participant.id}>
                <span><i className="status-dot" /> {participant.name}{participant.id === mySocketId ? " (you)" : ""}</span>
                <span className="participant-actions">
                  {participant.id === permissions?.hostId ? "Host" : participant.id === permissions?.editorId ? "Can edit" : "Viewer"}
                  {permissions?.role === "host" && participant.id !== mySocketId && participant.id !== permissions?.editorId && (
                    <button className="secondary-button tiny" onClick={() => giveControl(participant.id)}>Give control</button>
                  )}
                  {permissions?.role === "host" && participant.id === permissions.editorId && participant.id !== permissions.hostId && (
                    <button className="secondary-button tiny" onClick={takeControlBack}>Take back</button>
                  )}
                </span>
              </div>
            ))}
            <button className="secondary-button full" onClick={copyRoomCode}><Copy size={14} /> Copy room name</button>
          </div>

          <div className="panel-divider" /><div className="panel-heading">ROOM STATUS</div>
          <div className="detail-row"><span>Connection</span><span>{connectionStatus}</span></div>
          <div className="detail-row"><span>Participants</span><span>{participants.length}</span></div>
          <div className="detail-row"><span>Editing</span><span>{permissions?.editMode === "everyone" ? "Everyone" : "Controlled"}</span></div>
          <div className="detail-row"><span>Access</span><span>{permissions?.canEdit ? "Edit enabled" : "View only"}</span></div>

          <div className="panel-divider" /><div className="panel-heading">QUICK ACTIONS</div>
          {permissions?.role === "host" && <>
            <button className="quick-action" onClick={() => setEditMode(permissions.editMode === "everyone" ? "host" : "everyone")}>{permissions.editMode === "everyone" ? <LockKeyhole size={16} /> : <UnlockKeyhole size={16} />}{permissions.editMode === "everyone" ? "Lock editing" : "Allow everyone to edit"}</button>
            <p className="terminal-muted permission-hint">{permissions.editMode === "everyone" ? "All participants can edit." : "Only the host or assigned editor can edit."}</p>
          </>}
          <button className="quick-action" onClick={() => setChatOpen((value) => !value)}><MessageCircle size={16} /> Room chat</button>
          <button className="quick-action" onClick={() => setTerminalOpen((value) => !value)}><TerminalSquare size={16} /> {terminalOpen ? "Hide status console" : "Show status console"}</button>
          <button className="quick-action" onClick={() => setCallOpen(true)}><Video size={16} /> Video call</button>
          <button className="quick-action" onClick={runRoomCode} disabled={roomRunning || !permissions?.canEdit}><Play size={16} /> {roomRunning ? "Running..." : "Run code"}</button>
        </aside>

        {chatOpen && <aside className="chat-drawer">
          <div className="chat-header"><div><MessageCircle size={17} /><strong>Room chat</strong></div><button className="icon-button small" onClick={() => setChatOpen(false)} aria-label="Close chat"><X size={16} /></button></div>
          <div className="chat-messages">{chatMessages.length === 0 ? <p className="chat-empty">No messages yet. Start the conversation.</p> : chatMessages.map((message) => <article className="chat-message" key={message.id}><strong>{message.name}</strong><p>{message.message}</p></article>)}</div>
          <form className="chat-form" onSubmit={sendChat}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Message the room..." maxLength={2000} aria-label="Chat message" /><button className="primary-button" type="submit" aria-label="Send message"><Send size={15} /></button></form>
        </aside>}
      </div>
      {callOpen && <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Room video call">
        <section className="call-panel">
          <header className="call-header">
            <div><Video size={18} /><strong>Room video call</strong><span>{callJoined ? "Connected" : "Not in call"}</span></div>
            <button className="icon-button small" onClick={() => setCallOpen(false)} aria-label="Close call window"><X size={17} /></button>
          </header>
          <div className="call-video-grid">
            {localStream && <VideoTile stream={localStream} muted label="You" />}
            {Object.entries(remoteStreams).map(([peerId, stream], index) => (
              <VideoTile key={peerId} stream={stream} label={`Participant ${index + 1}`} />
            ))}
            {!callJoined && <div className="call-empty"><Video size={32} /><p>Join the call to enable your microphone and camera.</p></div>}
            {callJoined && remoteStreams && Object.keys(remoteStreams).length === 0 && (
              <div className="call-empty"><Users size={28} /><p>'You're in the call. Waiting for others to join...</p></div>
            )}
          </div>
          {callError && <p className="call-error" role="alert">{callError}</p>}
          <footer className="call-controls">
            {!callJoined ? (
              <button className="call-control primary" onClick={joinCall} disabled={callConnecting}>
                <Video size={17} /> {callConnecting ? "Connecting..." : "Join call"}
              </button>
            ) : <>
              <button className={`call-control ${micEnabled ? "" : "disabled"}`} onClick={toggleMicrophone}>
                {micEnabled ? <Mic size={18} /> : <MicOff size={18} />} {micEnabled ? "Mute" : "Unmute"}
              </button>
              <button className={`call-control ${cameraEnabled ? "" : "disabled"}`} onClick={toggleCamera}>
                {cameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />} {cameraEnabled ? "Camera off" : "Camera on"}
              </button>
              <button className="call-control hangup" onClick={leaveCall}><PhoneOff size={18} /> Leave call</button>
            </>}
          </footer>
        </section>
      </div>}
      {notice && <div className="notice-toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
    </main>
  );
}
