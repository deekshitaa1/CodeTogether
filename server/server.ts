import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server, type Socket } from "socket.io";
import Docker from "dockerode";

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT) || 3001;
const docker = process.env.DOCKER_SOCKET ? new Docker({ socketPath: process.env.DOCKER_SOCKET }) : process.platform === "win32" ? new Docker({ socketPath: "//./pipe/docker_engine" }) : null;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.replace(/\/$/, "")] : []),
];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "1mb" }));

type Participant = { id: string; name: string };
type EditMode = "host" | "everyone";

type Room = {
  code: string;
  participants: Map<string, Participant>;
  callParticipants: Set<string>;
  hostId: string;
  editorId: string;
  editMode: EditMode;
};

type Note = {
  id: string;
  topic: string;
  text: string;
  highlighted: boolean;
  createdAt: string;
  updatedAt: string;
};

type Student = {
  id: string;
  name: string;
  code: string;
  status: "learning" | "needs-help" | "working";
  notes: Note[];
};

type Classroom = {
  id: string;
  inviteCode: string;
  name: string;
  teacherId: string;
  teacherName: string;
  teacherCode: string;
  students: Map<string, Student>;
  publishedAt: string | null;
};

const rooms = new Map<string, Room>();
const socketRooms = new Map<string, string>();
const terminalSessions = new Map<string, { container: ReturnType<Docker["getContainer"]>; stream: NodeJS.ReadWriteStream }>();
const classrooms = new Map<string, Classroom>();
const inviteCodes = new Map<string, string>();
const classroomMembership = new Map<
  string,
  { classroomId: string; role: "teacher" | "student" }
>();

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
});

app.get("/", (_req, res) => {
  res.json({
    name: "CodeSync API",
    status: "running",
    message: "CodeSync backend is ready",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});


// ---------------- CODE EXECUTION: PISTON ----------------

const PISTON_URL = "http://127.0.0.1:2000/api/v2/execute";

const executionRuntimes: Record<string, { language: string; version: string; filename: string }> = {
  python: { language: "python", version: "3.12.0", filename: "main.py" },
  java: { language: "java", version: "15.0.2", filename: "Main.java" },
};

app.post("/api/execute", async (req, res) => {
  try {
    const { language, code, stdin = "" } = req.body ?? {};

    if (typeof language !== "string" || !executionRuntimes[language.toLowerCase()]) {
      res.status(400).json({ error: "Supported languages are Python and Java." });
      return;
    }
    if (typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "Code cannot be empty." });
      return;
    }
    if (code.length > 50000) {
      res.status(413).json({ error: "Code exceeds the 50 KB limit." });
      return;
    }
    if (typeof stdin !== "string" || stdin.length > 10000) {
      res.status(400).json({ error: "Invalid input. Maximum input size is 10 KB." });
      return;
    }

    const runtime = executionRuntimes[language.toLowerCase()];
    const pistonResponse = await fetch(PISTON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ name: runtime.filename, content: code }],
        stdin,
      }),
    });

    if (!pistonResponse.ok) {
      res.status(502).json({ error: "The code execution service returned an error." });
      return;
    }

    const result = await pistonResponse.json();
    res.json({
      success: result.run?.code === 0 && !result.run?.signal,
      compile: result.compile ?? null,
      run: result.run ?? null,
    });
  } catch (error) {
    console.error("Code execution error:", error);
    res.status(502).json({
      error: error instanceof Error && error.name === "TimeoutError"
        ? "Code execution request timed out."
        : "Unable to connect to the code execution service.",
    });
  }
});
// ---------------- EXISTING CODESYNC ROOMS ----------------

function sendPermissions(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const participant of room.participants.values()) {
    const isHost = participant.id === room.hostId;
    const canEdit =
      room.editMode === "everyone" ||
      participant.id === room.editorId ||
      isHost;

    io.to(participant.id).emit("room:permissions", {
      hostId: room.hostId,
      editorId: room.editorId,
      editMode: room.editMode,
      role: isHost ? "host" : canEdit ? "editor" : "viewer",
      canEdit,
    });
  }
}

async function cleanupTerminalSession(roomId: string) {
  const session = terminalSessions.get(roomId);
  if (!session) return;

  terminalSessions.delete(roomId);
  try {
    await session.container.remove({ force: true });
  } catch (error) {
    console.error("Terminal cleanup failed:", error);
  }
}
function removeParticipant(socket: Socket) {
  const roomId = socketRooms.get(socket.id);
  if (!roomId) return;

  const room = rooms.get(roomId);
  socket.leave(roomId);
  socketRooms.delete(socket.id);
  if (!room) return;

  if (room.callParticipants.delete(socket.id)) {
    socket.to(roomId).emit("call:peer-left", { id: socket.id });
    io.to(roomId).emit(
      "call:participants",
      Array.from(room.callParticipants),
    );
  }

  room.participants.delete(socket.id);

  if (room.participants.size === 0) {
    rooms.delete(roomId);
    void cleanupTerminalSession(roomId);
    return;
  }

  if (room.hostId === socket.id) {
    const nextHost = room.participants.keys().next().value as
      | string
      | undefined;

    if (nextHost) {
      room.hostId = nextHost;
      room.editorId = nextHost;
      room.editMode = "host";
    }
  } else if (room.editorId === socket.id) {
    room.editorId = room.hostId;
  }

  io.to(roomId).emit(
    "room:participants",
    Array.from(room.participants.values()),
  );
  sendPermissions(roomId);
}

// ---------------- CLASSROOM HELPERS ----------------

function getClassroom(socketId: string, role?: "teacher" | "student") {
  const membership = classroomMembership.get(socketId);
  if (!membership || (role && membership.role !== role)) return undefined;

  const classroom = classrooms.get(membership.classroomId);
  if (!classroom) return undefined;

  return { classroom, membership };
}

function teacherState(classroom: Classroom) {
  return {
    id: classroom.id,
    name: classroom.name,
    inviteCode: classroom.inviteCode,
    teacherName: classroom.teacherName,
    teacherCode: classroom.teacherCode,
    publishedAt: classroom.publishedAt,
    students: Array.from(classroom.students.values()).map((student) => ({
      id: student.id,
      name: student.name,
      code: student.code,
      status: student.status,
      notesCount: student.notes.length,
    })),
  };
}

function studentState(classroom: Classroom, student: Student) {
  return {
    id: classroom.id,
    name: classroom.name,
    teacherName: classroom.teacherName,
    code: student.code,
    publishedAt: classroom.publishedAt,
    status: student.status,
    notes: student.notes,
  };
}

function sendTeacherState(classroom: Classroom) {
  io.to(classroom.teacherId).emit(
    "classroom:teacher:state",
    teacherState(classroom),
  );
}

function sendStudentState(classroom: Classroom, student: Student) {
  io.to(student.id).emit(
    "classroom:student:state",
    studentState(classroom, student),
  );
}

function leaveClassroom(socket: Socket) {
  const membership = classroomMembership.get(socket.id);
  if (!membership) return;

  classroomMembership.delete(socket.id);
  socket.leave(membership.classroomId);

  const classroom = classrooms.get(membership.classroomId);
  if (!classroom) return;

  if (membership.role === "teacher") {
    io.to(classroom.id).emit("classroom:unavailable", {
      message: "The teacher disconnected. Classroom updates are paused.",
    });
    // Never promote a student to teacher automatically.
    return;
  }

  classroom.students.delete(socket.id);
  io.to(classroom.teacherId).emit("classroom:student:left", {
    id: socket.id,
  });
  sendTeacherState(classroom);
}

// ---------------- SOCKET EVENTS ----------------

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Existing shared CodeSync room.
  socket.on("room:join", (payload, callback) => {
    if (typeof payload?.roomId !== "string") {
      callback?.({ ok: false, error: "Enter a valid room name." });
      return;
    }

    const roomId = payload.roomId.trim();
    const name =
      typeof payload?.name === "string"
        ? payload.name.trim().slice(0, 40) || "Guest"
        : "Guest";

    if (!roomId || roomId.length > 80) {
      callback?.({ ok: false, error: "Enter a valid room name." });
      return;
    }

    removeParticipant(socket);

    let room = rooms.get(roomId);
    if (!room) {
      room = {
        code: "",
        participants: new Map(),
        callParticipants: new Set(),
        hostId: socket.id,
        editorId: socket.id,
        editMode: "host",
      };
      rooms.set(roomId, room);
    }

    room.participants.set(socket.id, { id: socket.id, name });
    socketRooms.set(socket.id, roomId);
    socket.join(roomId);

    callback?.({
      ok: true,
      participants: Array.from(room.participants.values()),
      code: room.code,
    });

    io.to(roomId).emit(
      "room:participants",
      Array.from(room.participants.values()),
    );
    sendPermissions(roomId);
    socket.to(roomId).emit("room:user-joined", {
      id: socket.id,
      name,
    });
  });

  // ---------------- WEBRTC ROOM SIGNALING ----------------
  socket.on("call:join", () => {
    const roomId = socketRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) return;

    if (room.callParticipants.has(socket.id)) {
      socket.emit("call:participants", Array.from(room.callParticipants));
      return;
    }

    room.callParticipants.add(socket.id);
    socket.emit("call:participants", Array.from(room.callParticipants));
    socket.to(roomId).emit("call:user-joined", { id: socket.id });
    io.to(roomId).emit("call:participants", Array.from(room.callParticipants));
  });

  socket.on("call:offer", (payload: {
    targetId?: string;
    description?: { type?: string; sdp?: string };
  }) => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;
    const targetId = payload?.targetId;
    const description = payload?.description;

    if (
      !room ||
      !room.callParticipants.has(socket.id) ||
      typeof targetId !== "string" ||
      targetId === socket.id ||
      !room.callParticipants.has(targetId) ||
      description?.type !== "offer" ||
      typeof description.sdp !== "string" ||
      description.sdp.length > 100000
    ) return;

    io.to(targetId).emit("call:offer", { from: socket.id, description });
  });

  socket.on("call:answer", (payload: {
    targetId?: string;
    description?: { type?: string; sdp?: string };
  }) => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;
    const targetId = payload?.targetId;
    const description = payload?.description;

    if (
      !room ||
      !room.callParticipants.has(socket.id) ||
      typeof targetId !== "string" ||
      targetId === socket.id ||
      !room.callParticipants.has(targetId) ||
      description?.type !== "answer" ||
      typeof description.sdp !== "string" ||
      description.sdp.length > 100000
    ) return;

    io.to(targetId).emit("call:answer", { from: socket.id, description });
  });

  socket.on("call:ice-candidate", (payload: {
    targetId?: string;
    candidate?: {
      candidate?: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
      usernameFragment?: string | null;
    };
  }) => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;
    const targetId = payload?.targetId;
    const candidate = payload?.candidate;

    if (
      !room ||
      !room.callParticipants.has(socket.id) ||
      typeof targetId !== "string" ||
      targetId === socket.id ||
      !room.callParticipants.has(targetId) ||
      typeof candidate?.candidate !== "string" ||
      candidate.candidate.length > 10000
    ) return;

    io.to(targetId).emit("call:ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  socket.on("call:leave", () => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;

    if (!room || !room.callParticipants.delete(socket.id)) return;

    socket.to(roomId!).emit("call:peer-left", { id: socket.id });
    io.to(roomId!).emit(
      "call:participants",
      Array.from(room.callParticipants),
    );
  });
  socket.on("code:update", (payload: { code?: string }) => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;

    if (
      !room ||
      typeof payload?.code !== "string" ||
      payload.code.length > 500_000
    ) return;

    const canEdit =
      room.editMode === "everyone" ||
      socket.id === room.editorId ||
      socket.id === room.hostId;

    if (!canEdit) {
      socket.emit("code:update:rejected", {
        reason: "You do not currently have editing permission.",
      });
      if (roomId) sendPermissions(roomId);
      return;
    }

    room.code = payload.code;
    socket.to(roomId!).emit("code:update", {
      code: payload.code,
      senderId: socket.id,
    });
  });

  socket.on(
    "room:control:set",
    (payload: { mode?: EditMode; editorId?: string }) => {
      const roomId = socketRooms.get(socket.id);
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room || socket.id !== room.hostId) return;

      if (payload?.mode === "everyone") {
        room.editMode = "everyone";
        room.editorId = room.hostId;
      } else if (payload?.mode === "host") {
        room.editMode = "host";
        room.editorId = room.hostId;
      } else if (
        typeof payload?.editorId === "string" &&
        room.participants.has(payload.editorId)
      ) {
        room.editMode = "host";
        room.editorId = payload.editorId;
      } else {
        return;
      }

      if (roomId) sendPermissions(roomId);
    },
  );

  socket.on("chat:send", (payload: { message?: string }) => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;
    const message =
      typeof payload?.message === "string"
        ? payload.message.trim().slice(0, 2000)
        : "";

    if (!room || !message) return;

    const participant = room.participants.get(socket.id);
    io.to(roomId!).emit("chat:message", {
      id: `${Date.now()}-${socket.id}`,
      name: participant?.name || "Guest",
      message,
      timestamp: new Date().toISOString(),
    });
  });

  // ---------------- CLASSROOM: TEACHER CREATES ----------------

  socket.on("classroom:create", (payload, callback) => {
    const name =
      typeof payload?.name === "string"
        ? payload.name.trim().slice(0, 80)
        : "";
    const teacherName =
      typeof payload?.teacherName === "string"
        ? payload.teacherName.trim().slice(0, 40) || "Teacher"
        : "Teacher";
    const initialCode =
      typeof payload?.initialCode === "string"
        ? payload.initialCode.slice(0, 500_000)
        : "";

    if (!name) {
      callback?.({ ok: false, error: "Enter a classroom name." });
      return;
    }

    leaveClassroom(socket);

    const id = randomBytes(8).toString("hex");
    let inviteCode = randomBytes(4).toString("hex").toUpperCase();

    while (inviteCodes.has(inviteCode)) {
      inviteCode = randomBytes(4).toString("hex").toUpperCase();
    }

    const classroom: Classroom = {
      id,
      inviteCode,
      name,
      teacherId: socket.id,
      teacherName,
      teacherCode: initialCode,
      students: new Map(),
      publishedAt: null,
    };

    classrooms.set(id, classroom);
    inviteCodes.set(inviteCode, id);
    classroomMembership.set(socket.id, {
      classroomId: id,
      role: "teacher",
    });
    socket.join(id);

    callback?.({
      ok: true,
      classroom: {
        id,
        name,
        inviteCode,
        teacherName,
      },
    });

    sendTeacherState(classroom);
    console.log(`Classroom created: ${name}`);
  });

  // ---------------- CLASSROOM: STUDENT JOINS BY INVITE ----------------

  socket.on("classroom:join", (payload, callback) => {
    const inviteCode =
      typeof payload?.inviteCode === "string"
        ? payload.inviteCode.trim().toUpperCase()
        : "";
    const studentName =
      typeof payload?.studentName === "string"
        ? payload.studentName.trim().slice(0, 40) || "Student"
        : "Student";

    const classroomId = inviteCodes.get(inviteCode);
    const classroom = classroomId
      ? classrooms.get(classroomId)
      : undefined;

    if (!classroom) {
      callback?.({
        ok: false,
        error: "That invitation code is not valid.",
      });
      return;
    }

    leaveClassroom(socket);

    const student: Student = {
      id: socket.id,
      name: studentName,
      // Start with a separate copy of the teacher's current code.
      code: classroom.teacherCode,
      status: "learning",
      notes: [],
    };

    classroom.students.set(socket.id, student);
    classroomMembership.set(socket.id, {
      classroomId: classroom.id,
      role: "student",
    });
    socket.join(classroom.id);

    callback?.({
      ok: true,
      classroom: studentState(classroom, student),
    });

    sendTeacherState(classroom);
    io.to(classroom.teacherId).emit("classroom:student:joined", {
      id: student.id,
      name: student.name,
      status: student.status,
    });
  });

  // ---------------- PRIVATE TEACHER CODE ----------------

  socket.on(
    "classroom:teacher:code:update",
    (payload: { code?: string }) => {
      const membership = getClassroom(socket.id, "teacher");
      if (
        !membership ||
        typeof payload?.code !== "string" ||
        payload.code.length > 500_000
      ) return;

      const { classroom } = membership;
      classroom.teacherCode = payload.code;

      // Do not broadcast teacher's private code to students.
      socket.emit("classroom:teacher:code:ack", {
        code: classroom.teacherCode,
      });
      sendTeacherState(classroom);
    },
  );

  // ---------------- INDEPENDENT STUDENT CODE ----------------

  socket.on(
    "classroom:student:code:update",
    (payload: { code?: string }) => {
      const membership = getClassroom(socket.id, "student");
      if (
        !membership ||
        typeof payload?.code !== "string" ||
        payload.code.length > 500_000
      ) return;

      const { classroom } = membership;
      const student = classroom.students.get(socket.id);
      if (!student) return;

      student.code = payload.code;

      // Teacher receives a read-only monitoring update.
      io.to(classroom.teacherId).emit("classroom:student:code", {
        id: student.id,
        name: student.name,
        code: student.code,
      });
      sendTeacherState(classroom);
    },
  );

  // ---------------- TEACHER PUBLISHES A COPY ----------------

  socket.on("classroom:publish", (_payload, callback) => {
    const membership = getClassroom(socket.id, "teacher");
    if (!membership) {
      callback?.({
        ok: false,
        error: "Only the teacher can publish classroom code.",
      });
      return;
    }

    const { classroom } = membership;
    classroom.publishedAt = new Date().toISOString();

    for (const student of classroom.students.values()) {
      // Copy once; future edits remain independent.
      student.code = classroom.teacherCode;
      io.to(student.id).emit("classroom:student:published", {
        code: student.code,
        publishedAt: classroom.publishedAt,
      });
      sendStudentState(classroom, student);
    }

    callback?.({
      ok: true,
      publishedAt: classroom.publishedAt,
    });
    sendTeacherState(classroom);
  });

  // ---------------- STUDENT PROGRESS / HELP STATUS ----------------

  socket.on(
    "classroom:student:status",
    (payload: { status?: Student["status"] }) => {
      const membership = getClassroom(socket.id, "student");
      if (!membership) return;

      const { classroom } = membership;
      const student = classroom.students.get(socket.id);
      if (!student) return;

      if (
        payload?.status !== "learning" &&
        payload?.status !== "needs-help" &&
        payload?.status !== "working"
      ) return;

      student.status = payload.status;
      io.to(classroom.teacherId).emit("classroom:student:status", {
        id: student.id,
        name: student.name,
        status: student.status,
      });
      sendTeacherState(classroom);
    },
  );

  // ---------------- PRIVATE STUDENT NOTES ----------------

  socket.on("classroom:notes:save", (payload, callback) => {
    const membership = getClassroom(socket.id, "student");
    if (!membership) {
      callback?.({ ok: false, error: "Join a classroom first." });
      return;
    }

    const { classroom } = membership;
    const student = classroom.students.get(socket.id);
    const topic =
      typeof payload?.topic === "string"
        ? payload.topic.trim().slice(0, 100)
        : "";
    const text =
      typeof payload?.text === "string"
        ? payload.text.trim().slice(0, 10_000)
        : "";

    if (!student || !topic || !text) {
      callback?.({
        ok: false,
        error: "Enter both a topic and note text.",
      });
      return;
    }

    const now = new Date().toISOString();
    const existing =
      typeof payload?.id === "string"
        ? student.notes.find((note) => note.id === payload.id)
        : undefined;

    if (existing) {
      existing.topic = topic;
      existing.text = text;
      existing.highlighted = Boolean(payload?.highlighted);
      existing.updatedAt = now;
      callback?.({ ok: true, note: existing });
    } else {
      const note: Note = {
        id: randomBytes(8).toString("hex"),
        topic,
        text,
        highlighted: Boolean(payload?.highlighted),
        createdAt: now,
        updatedAt: now,
      };
      student.notes.unshift(note);
      callback?.({ ok: true, note });
    }

    // Only the student who owns these notes receives them.
    sendStudentState(classroom, student);
  });

  socket.on(
    "classroom:notes:delete",
    (payload: { id?: string }, callback) => {
      const membership = getClassroom(socket.id, "student");
      if (!membership || typeof payload?.id !== "string") {
        callback?.({ ok: false, error: "Note not found." });
        return;
      }

      const { classroom } = membership;
      const student = classroom.students.get(socket.id);
      if (!student) {
        callback?.({ ok: false, error: "Student not found." });
        return;
      }

      const oldLength = student.notes.length;
      student.notes = student.notes.filter(
        (note) => note.id !== payload.id,
      );
      const deleted = student.notes.length < oldLength;

      callback?.({
        ok: deleted,
        error: deleted ? undefined : "Note not found.",
      });
      sendStudentState(classroom, student);
    },
  );

  // Interactive Docker terminal shared by participants in a CodeSync room.
  function canUseRoomTerminal(roomId: string) {
    const room = rooms.get(roomId);
    return Boolean(
      room &&
      room.participants.has(socket.id) &&
      (
        room.editMode === "everyone" ||
        socket.id === room.editorId ||
        socket.id === room.hostId
      )
    );
  }

  socket.on("terminal:start", async (_payload, callback) => {
    const roomId = socketRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : undefined;

    if (!roomId || !room || !canUseRoomTerminal(roomId)) {
      callback?.({ ok: false, error: "You do not have terminal permission in this room." });
      return;
    }

    if (terminalSessions.has(roomId)) {
      callback?.({ ok: true, message: "Room terminal is already running." });
      return;
    }

    if (!docker) {
      callback?.({ ok: false, error: "Interactive terminal is unavailable on this deployment." });
      return;
    }

    let container: Awaited<ReturnType<typeof docker.createContainer>> | undefined;

    try {
      container = await docker.createContainer({
        Image: "codesync-python-node",
        Cmd: ["/bin/sh"],
        WorkingDir: "/workspace",
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        OpenStdin: true,
        StdinOnce: false,
        Labels: {
          app: "codesync",
          room: randomBytes(8).toString("hex"),
          purpose: "room-terminal",
        },
        HostConfig: {
          NetworkMode: "none",
          Memory: 268435456,
          NanoCpus: 500000000,
          PidsLimit: 64,
          SecurityOpt: ["no-new-privileges:true"],
        },
      });

      const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      });

      terminalSessions.set(roomId, {
        container,
        stream: stream as NodeJS.ReadWriteStream,
      });

      stream.on("data", (chunk: Buffer) => {
        io.to(roomId).emit("terminal:output", chunk.toString("utf8"));
      });

      stream.on("error", (error: Error) => {
        console.error("Terminal stream error:", error);
        io.to(roomId).emit("terminal:error", "Terminal connection error.");
      });

      stream.on("end", () => {
        io.to(roomId).emit("terminal:status", "Terminal session ended.");
      });

      await container.start();

      callback?.({ ok: true });
      io.to(roomId).emit("terminal:status", "Terminal connected.");
    } catch (error) {
      terminalSessions.delete(roomId);

      if (container) {
        try {
          await container.remove({ force: true });
        } catch (cleanupError) {
          console.error("Failed to remove terminal container:", cleanupError);
        }
      }

      console.error("Terminal start failed:", error);
      callback?.({ ok: false, error: "Could not start the room terminal." });
    }
  });

  socket.on("terminal:input", (payload, callback) => {
    const roomId = socketRooms.get(socket.id);
    const input = payload?.data;

    if (
      !roomId ||
      !canUseRoomTerminal(roomId) ||
      typeof input !== "string" ||
      input.length === 0 ||
      input.length > 4096
    ) {
      callback?.({ ok: false, error: "Invalid terminal input or permission denied." });
      return;
    }

    const session = terminalSessions.get(roomId);
    if (!session) {
      callback?.({ ok: false, error: "Start the room terminal first." });
      return;
    }

    session.stream.write(input);
    callback?.({ ok: true });
  });

  socket.on("terminal:run", (payload, callback) => {
    const roomId = socketRooms.get(socket.id);
    const language = payload?.language;
    const codeBase64 = payload?.codeBase64;

    if (!roomId || !canUseRoomTerminal(roomId)) {
      callback?.({ ok: false, error: "Terminal permission denied." });
      return;
    }

    if (
      language !== "python" ||
      typeof codeBase64 !== "string" ||
      codeBase64.length === 0 ||
      codeBase64.length > 70000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(codeBase64)
    ) {
      callback?.({ ok: false, error: "Invalid Python code payload." });
      return;
    }

    const session = terminalSessions.get(roomId);
    if (!session) {
      callback?.({ ok: false, error: "Start the room terminal first." });
      return;
    }

    const command = `printf '%s' '${codeBase64}' | base64 -d > /workspace/main.py && python3 -u /workspace/main.py\n`;
    session.stream.write(command);
    callback?.({ ok: true });
  });
  socket.on("terminal:stop", async (_payload, callback) => {
    const roomId = socketRooms.get(socket.id);

    if (!roomId || !canUseRoomTerminal(roomId)) {
      callback?.({ ok: false, error: "You do not have terminal permission in this room." });
      return;
    }

    await cleanupTerminalSession(roomId);
    io.to(roomId).emit("terminal:status", "Terminal stopped.");
    callback?.({ ok: true });
  });
  socket.on("disconnect", () => {
    removeParticipant(socket);
    leaveClassroom(socket);
    console.log("Disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`CodeSync server running at http://localhost:${PORT}`);
});

