import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);

const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function clientId() {
  return crypto.randomUUID();
}

function makeRoom(id = roomCode()) {
  return {
    id,
    phase: "lobby",
    maxPlayers: 4,
    players: [],
    settings: {
      min: 0,
      max: 100,
      count: 30
    },
    board: [],
    targets: [],
    currentIndex: 0,
    found: [],
    hostId: null,
    createdAt: Date.now(),
    clients: new Set()
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    phase: room.phase,
    maxPlayers: room.maxPlayers,
    players: room.players,
    settings: room.settings,
    board: room.board,
    targets: room.targets,
    currentIndex: room.currentIndex,
    currentTarget: room.targets[room.currentIndex] ?? null,
    found: room.found,
    hostId: room.hostId
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function emit(room) {
  const data = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const res of room.clients) res.write(data);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickNumbers(min, max, count) {
  const pool = [];
  for (let n = min; n <= max; n += 1) pool.push(n);
  return shuffle(pool).slice(0, count);
}

function buildRound(room) {
  const numbers = pickNumbers(room.settings.min, room.settings.max, room.settings.count);
  room.board = shuffle(numbers).map((number, index) => ({
    id: `${Date.now()}-${index}-${number}`,
    number,
    found: false
  }));
  room.targets = shuffle(numbers);
  room.currentIndex = 0;
  room.found = [];
  room.phase = "playing";
  room.players = room.players.map((player) => ({ ...player, score: 0 }));
}

function validateSettings({ min, max, count, maxPlayers }) {
  const low = Number(min);
  const high = Number(max);
  const amount = Number(count);
  const playerCap = Number(maxPlayers);

  if (!Number.isInteger(low) || !Number.isInteger(high)) {
    return "数字区间必须是整数。";
  }
  if (low < 0 || high < 0 || high <= low) {
    return "请输入有效自然数区间，例如 0 到 100。";
  }
  const size = high - low + 1;
  if (!Number.isInteger(amount) || amount < 1 || amount >= size) {
    return `图纸数字个数必须大于 0，并且小于区间数量 ${size}。`;
  }
  if (!Number.isInteger(playerCap) || playerCap < 1 || playerCap > 4) {
    return "人数必须是 1 到 4 人。";
  }
  return null;
}

function validatePlayerCap(room, maxPlayers) {
  const playerCap = Number(maxPlayers);
  if (!Number.isInteger(playerCap) || playerCap < 1 || playerCap > 4) {
    return "人数必须是 1 到 4 人。";
  }
  if (room.players.length > playerCap) {
    return `当前已有 ${room.players.length} 人，不能把人数改成 ${playerCap} 人。`;
  }
  return null;
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function requirePlayer(room, playerId) {
  if (!findPlayer(room, playerId)) {
    return "请先加入房间，再修改设置或控制游戏。";
  }
  return null;
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/room") {
    const room = makeRoom();
    rooms.set(room.id, room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/([a-z]+))?$/);
  if (!match) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const [, roomId, action] = match;
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { error: "房间不存在。" });
    return;
  }

  if (req.method === "GET" && action === "events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    room.clients.add(res);
    res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
    req.on("close", () => room.clients.delete(res));
    return;
  }

  if (req.method === "POST" && action === "join") {
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 18) || `玩家${room.players.length + 1}`;
    if (room.players.length >= room.maxPlayers) {
      sendJson(res, 409, { error: "房间人数已满。" });
      return;
    }
    const player = { id: clientId(), name, score: 0, joinedAt: Date.now() };
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
    emit(room);
    sendJson(res, 200, { player, room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "config") {
    const body = await readBody(req);
    const playerError = requirePlayer(room, body.playerId);
    if (playerError) {
      sendJson(res, 403, { error: playerError });
      return;
    }
    if (room.phase !== "lobby") {
      sendJson(res, 400, { error: "本局开始后不能修改人数，请结束后重新设置。" });
      return;
    }
    const error = validatePlayerCap(room, body.maxPlayers);
    if (error) {
      sendJson(res, 400, { error });
      return;
    }
    room.maxPlayers = Number(body.maxPlayers);
    emit(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "start") {
    const body = await readBody(req);
    const playerError = requirePlayer(room, body.playerId);
    if (playerError) {
      sendJson(res, 403, { error: playerError });
      return;
    }
    const error = validateSettings(body);
    if (error) {
      sendJson(res, 400, { error });
      return;
    }
    const capError = validatePlayerCap(room, body.maxPlayers);
    if (capError) {
      sendJson(res, 400, { error: capError });
      return;
    }
    room.maxPlayers = Number(body.maxPlayers);
    room.settings = {
      min: Number(body.min),
      max: Number(body.max),
      count: Number(body.count)
    };
    buildRound(room);
    emit(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "replay") {
    const body = await readBody(req);
    const playerError = requirePlayer(room, body.playerId);
    if (playerError) {
      sendJson(res, 403, { error: playerError });
      return;
    }
    const capError = validatePlayerCap(room, room.maxPlayers);
    if (capError) {
      sendJson(res, 400, { error: capError });
      return;
    }
    buildRound(room);
    emit(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "claim") {
    const body = await readBody(req);
    const target = room.targets[room.currentIndex];
    const cell = room.board.find((item) => item.id === body.cellId);
    const player = room.players.find((item) => item.id === body.playerId);

    if (room.phase !== "playing" || target == null || !cell || !player) {
      sendJson(res, 400, { error: "当前不能抢答。" });
      return;
    }
    if (cell.found || cell.number !== target) {
      sendJson(res, 400, { error: "还没找对，继续看图纸。" });
      return;
    }

    cell.found = true;
    player.score += 1;
    room.found.push({ number: cell.number, playerId: player.id, playerName: player.name, at: Date.now() });
    room.currentIndex += 1;
    if (room.currentIndex >= room.targets.length) room.phase = "finished";
    emit(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "end") {
    const body = await readBody(req);
    const playerError = requirePlayer(room, body.playerId);
    if (playerError) {
      sendJson(res, 403, { error: playerError });
      return;
    }
    room.phase = "finished";
    emit(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "reset") {
    const body = await readBody(req);
    const playerError = requirePlayer(room, body.playerId);
    if (playerError) {
      sendJson(res, 403, { error: playerError });
      return;
    }
    room.phase = "lobby";
    room.board = [];
    room.targets = [];
    room.currentIndex = 0;
    room.found = [];
    room.players = room.players.map((player) => ({ ...player, score: 0 }));
    emit(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const cleanPath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, cleanPath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    const data = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": mimeTypes[".html"] });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Find Number Party is running at http://localhost:${port}`);
});
