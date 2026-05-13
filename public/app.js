const state = {
  room: null,
  player: null,
  playerCap: 4,
  events: null
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  roomCode: $("#roomCode"),
  newRoomBtn: $("#newRoomBtn"),
  copyLinkBtn: $("#copyLinkBtn"),
  joinForm: $("#joinForm"),
  playerName: $("#playerName"),
  players: $("#players"),
  settingsForm: $("#settingsForm"),
  playerCap: $("#playerCap"),
  minNumber: $("#minNumber"),
  maxNumber: $("#maxNumber"),
  numberCount: $("#numberCount"),
  startBtn: $("#startBtn"),
  endBtn: $("#endBtn"),
  resetBtn: $("#resetBtn"),
  resultPanel: $("#resultPanel"),
  winnerTitle: $("#winnerTitle"),
  winnerDetail: $("#winnerDetail"),
  replayBtn: $("#replayBtn"),
  openSettingsBtn: $("#openSettingsBtn"),
  settingsDialog: $("#settingsDialog"),
  dialogSettingsForm: $("#dialogSettingsForm"),
  closeSettingsBtn: $("#closeSettingsBtn"),
  dialogPlayerCap: $("#dialogPlayerCap"),
  dialogMinNumber: $("#dialogMinNumber"),
  dialogMaxNumber: $("#dialogMaxNumber"),
  dialogNumberCount: $("#dialogNumberCount"),
  board: $("#board"),
  currentTarget: $("#currentTarget"),
  progress: $("#progress"),
  phaseLabel: $("#phaseLabel"),
  message: $("#message")
};

const params = new URLSearchParams(location.search);

function setMessage(text, good = false) {
  elements.message.textContent = text;
  elements.message.style.color = good ? "#1f766f" : "#b84336";
  if (text) {
    window.clearTimeout(setMessage.timer);
    setMessage.timer = window.setTimeout(() => {
      elements.message.textContent = "";
    }, 2600);
  }
}

async function api(path, payload = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function roomLink() {
  return `${location.origin}${location.pathname}?room=${state.room.id}`;
}

function isJoinedPlayer() {
  return Boolean(state.player && state.room?.players.some((player) => player.id === state.player.id));
}

async function createRoom() {
  const data = await api("/api/room");
  history.replaceState(null, "", `?room=${data.room.id}`);
  connect(data.room.id);
}

function connect(roomId) {
  if (state.events) state.events.close();
  state.player = JSON.parse(localStorage.getItem(`findNumberPlayer:${roomId}`) || "null");
  state.events = new EventSource(`/api/rooms/${roomId}/events`);
  state.events.onmessage = (event) => {
    state.room = JSON.parse(event.data);
    state.playerCap = state.room.maxPlayers;
    if (state.player && !state.room.players.some((player) => player.id === state.player.id)) {
      state.player = null;
      localStorage.removeItem(`findNumberPlayer:${state.room.id}`);
    }
    render();
  };
  state.events.onerror = () => {
    setMessage("连接断开了，刷新页面可重新加入。");
  };
}

function gamePayload(extra = {}) {
  return {
    playerId: state.player?.id,
    ...extra
  };
}

function phaseText(phase) {
  if (phase === "playing") return "游戏中";
  if (phase === "finished") return "已结束";
  return "等待开始";
}

function columnsFor(count) {
  if (count <= 16) return 4;
  if (count <= 36) return 6;
  if (count <= 64) return 8;
  if (count <= 100) return 10;
  if (count <= 144) return 12;
  return 14;
}

function fitCellText(cell, number) {
  const digits = String(number).length;
  if (digits >= 5) cell.style.fontSize = "14px";
  if (digits >= 7) cell.style.fontSize = "12px";
}

function renderPlayers() {
  const players = state.room?.players || [];
  elements.players.innerHTML = players.length
    ? players
        .map((player) => {
          const isMe = state.player?.id === player.id;
          const isHost = state.room.hostId === player.id;
          return `
            <div class="player">
              <div>
                <strong>${escapeHtml(player.name)}${isMe ? "（我）" : ""}</strong>
                <small>${isHost ? "房主" : "玩家"}</small>
              </div>
              <div class="score">${player.score}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">还没有玩家加入。</div>`;
}

function winners() {
  const players = state.room?.players || [];
  if (!players.length) return [];
  const topScore = Math.max(...players.map((player) => player.score));
  return players.filter((player) => player.score === topScore && topScore > 0);
}

function renderResults() {
  const isFinished = state.room?.phase === "finished";
  elements.resultPanel.classList.toggle("hidden", !isFinished);
  if (!isFinished) return;

  const roundWinners = winners();
  if (!roundWinners.length) {
    elements.winnerTitle.textContent = "本局没有得分";
    elements.winnerDetail.textContent = "可以直接再来一局，或者重新设置数字范围。";
    return;
  }

  const names = roundWinners.map((player) => player.name).join("、");
  const score = roundWinners[0].score;
  elements.winnerTitle.textContent = `${names} 获胜`;
  elements.winnerDetail.textContent = `最高分 ${score} 分，共找到 ${state.room.found.length} 个数字。`;
}

function renderBoard() {
  const board = state.room?.board || [];
  elements.board.innerHTML = "";

  if (!board.length) {
    elements.board.className = "board empty";
    elements.board.style.removeProperty("--cols");
    elements.board.innerHTML = `<div class="empty-state">先加入房间，设置人数、数字区间和图纸数量，然后开始找数字。</div>`;
    return;
  }

  elements.board.className = "board";
  elements.board.style.setProperty("--cols", columnsFor(board.length));
  const canPlay = state.room.phase === "playing" && state.player;

  for (const item of board) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `cell${item.found ? " found" : ""}`;
    cell.textContent = item.number;
    cell.disabled = !canPlay || item.found;
    cell.addEventListener("click", () => claim(item.id));
    fitCellText(cell, item.number);
    elements.board.append(cell);
  }
}

function render() {
  if (!state.room) return;
  const joined = isJoinedPlayer();
  elements.roomCode.textContent = state.room.id;
  elements.currentTarget.textContent = state.room.currentTarget ?? "-";
  elements.progress.textContent = `${state.room.currentIndex} / ${state.room.targets.length}`;
  elements.phaseLabel.textContent = phaseText(state.room.phase);
  elements.startBtn.disabled = !joined || state.room.phase === "playing";
  elements.endBtn.disabled = !joined || state.room.phase !== "playing";
  elements.resetBtn.disabled = !joined || state.room.phase === "playing";
  elements.replayBtn.disabled = !joined || state.room.phase !== "finished";
  elements.openSettingsBtn.disabled = !joined || state.room.phase !== "finished";
  elements.copyLinkBtn.disabled = !state.room.id;

  for (const button of elements.playerCap.querySelectorAll("button")) {
    button.classList.toggle("active", Number(button.dataset.value) === state.playerCap);
    button.disabled = !joined || state.room.phase !== "lobby";
  }

  for (const input of elements.settingsForm.querySelectorAll("input")) {
    input.disabled = !joined || state.room.phase === "playing";
  }

  renderPlayers();
  renderResults();
  renderBoard();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

async function join(event) {
  event.preventDefault();
  try {
    if (!state.room) return;
    const data = await api(`/api/rooms/${state.room.id}/join`, {
      name: elements.playerName.value
    });
    state.player = data.player;
    localStorage.setItem(`findNumberPlayer:${state.room.id}`, JSON.stringify(state.player));
    setMessage("已加入，可以开始找数字了。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

async function start(event) {
  event.preventDefault();
  try {
    if (!state.room) return;
    const data = {
      playerId: state.player?.id,
      maxPlayers: state.playerCap,
      min: elements.minNumber.value,
      max: elements.maxNumber.value,
      count: elements.numberCount.value
    };
    await api(`/api/rooms/${state.room.id}/start`, data);
    setMessage("图纸已生成。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

function syncDialogValues() {
  elements.dialogMinNumber.value = state.room?.settings.min ?? elements.minNumber.value;
  elements.dialogMaxNumber.value = state.room?.settings.max ?? elements.maxNumber.value;
  elements.dialogNumberCount.value = state.room?.settings.count ?? elements.numberCount.value;
  state.playerCap = state.room?.maxPlayers ?? state.playerCap;
  renderDialogPlayerCap();
}

function renderDialogPlayerCap() {
  for (const button of elements.dialogPlayerCap.querySelectorAll("button")) {
    button.classList.toggle("active", Number(button.dataset.value) === state.playerCap);
  }
}

async function startFromDialog(event) {
  event.preventDefault();
  try {
    if (!state.room) return;
    await api(`/api/rooms/${state.room.id}/start`, gamePayload({
      maxPlayers: state.playerCap,
      min: elements.dialogMinNumber.value,
      max: elements.dialogMaxNumber.value,
      count: elements.dialogNumberCount.value
    }));
    elements.minNumber.value = elements.dialogMinNumber.value;
    elements.maxNumber.value = elements.dialogMaxNumber.value;
    elements.numberCount.value = elements.dialogNumberCount.value;
    elements.settingsDialog.close();
    setMessage("已按新设置开始。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

async function claim(cellId) {
  try {
    await api(`/api/rooms/${state.room.id}/claim`, {
      playerId: state.player?.id,
      cellId
    });
    setMessage("找到了，加一分。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

elements.newRoomBtn.addEventListener("click", createRoom);
elements.copyLinkBtn.addEventListener("click", async () => {
  if (!state.room) return;
  await navigator.clipboard.writeText(roomLink());
  setMessage("邀请链接已复制。", true);
});
elements.joinForm.addEventListener("submit", join);
elements.settingsForm.addEventListener("submit", start);
elements.endBtn.addEventListener("click", async () => {
  await api(`/api/rooms/${state.room.id}/end`, gamePayload());
});
elements.resetBtn.addEventListener("click", async () => {
  await api(`/api/rooms/${state.room.id}/reset`, gamePayload());
});
elements.replayBtn.addEventListener("click", async () => {
  try {
    await api(`/api/rooms/${state.room.id}/replay`, gamePayload());
    setMessage("新一局开始了。", true);
  } catch (error) {
    setMessage(error.message);
  }
});
elements.openSettingsBtn.addEventListener("click", () => {
  syncDialogValues();
  elements.settingsDialog.showModal();
});
elements.closeSettingsBtn.addEventListener("click", () => {
  elements.settingsDialog.close();
});
elements.dialogSettingsForm.addEventListener("submit", startFromDialog);
elements.playerCap.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.playerCap = Number(button.dataset.value);
  render();
  if (state.room?.phase === "lobby") {
    api(`/api/rooms/${state.room.id}/config`, gamePayload({ maxPlayers: state.playerCap })).catch((error) => {
      state.playerCap = state.room.maxPlayers;
      render();
      setMessage(error.message);
    });
  }
});
elements.dialogPlayerCap.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.playerCap = Number(button.dataset.value);
  renderDialogPlayerCap();
});

const roomFromUrl = params.get("room");
if (roomFromUrl) {
  connect(roomFromUrl.toUpperCase());
} else {
  createRoom();
}
const state = {
  room: null,
  player: null,
  playerCap: 4,
  events: null
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  roomCode: $("#roomCode"),
  newRoomBtn: $("#newRoomBtn"),
  copyLinkBtn: $("#copyLinkBtn"),
  joinForm: $("#joinForm"),
  playerName: $("#playerName"),
  players: $("#players"),
  settingsForm: $("#settingsForm"),
  playerCap: $("#playerCap"),
  minNumber: $("#minNumber"),
  maxNumber: $("#maxNumber"),
  numberCount: $("#numberCount"),
  startBtn: $("#startBtn"),
  endBtn: $("#endBtn"),
  resetBtn: $("#resetBtn"),
  board: $("#board"),
  currentTarget: $("#currentTarget"),
  progress: $("#progress"),
  phaseLabel: $("#phaseLabel"),
  message: $("#message")
};

const params = new URLSearchParams(location.search);

function setMessage(text, good = false) {
  elements.message.textContent = text;
  elements.message.style.color = good ? "#1f766f" : "#b84336";
  if (text) {
    window.clearTimeout(setMessage.timer);
    setMessage.timer = window.setTimeout(() => {
      elements.message.textContent = "";
    }, 2600);
  }
}

async function api(path, payload = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function roomLink() {
  return `${location.origin}${location.pathname}?room=${state.room.id}`;
}

async function createRoom() {
  const data = await api("/api/room");
  history.replaceState(null, "", `?room=${data.room.id}`);
  connect(data.room.id);
}

function connect(roomId) {
  if (state.events) state.events.close();
  state.player = JSON.parse(localStorage.getItem(`findNumberPlayer:${roomId}`) || "null");
  state.events = new EventSource(`/api/rooms/${roomId}/events`);
  state.events.onmessage = (event) => {
    state.room = JSON.parse(event.data);
    state.playerCap = state.room.maxPlayers;
    if (state.player && !state.room.players.some((player) => player.id === state.player.id)) {
      state.player = null;
      localStorage.removeItem(`findNumberPlayer:${state.room.id}`);
    }
    render();
  };
  state.events.onerror = () => {
    setMessage("连接断开了，刷新页面可重新加入。");
  };
}

function phaseText(phase) {
  if (phase === "playing") return "游戏中";
  if (phase === "finished") return "已结束";
  return "等待开始";
}

function columnsFor(count) {
  if (count <= 16) return 4;
  if (count <= 36) return 6;
  if (count <= 64) return 8;
  if (count <= 100) return 10;
  if (count <= 144) return 12;
  return 14;
}

function fitCellText(cell, number) {
  const digits = String(number).length;
  if (digits >= 5) cell.style.fontSize = "14px";
  if (digits >= 7) cell.style.fontSize = "12px";
}

function renderPlayers() {
  const players = state.room?.players || [];
  elements.players.innerHTML = players.length
    ? players
        .map((player) => {
          const isMe = state.player?.id === player.id;
          const isHost = state.room.hostId === player.id;
          return `
            <div class="player">
              <div>
                <strong>${escapeHtml(player.name)}${isMe ? "（我）" : ""}</strong>
                <small>${isHost ? "房主" : "玩家"}</small>
              </div>
              <div class="score">${player.score}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">还没有玩家加入。</div>`;
}

function renderBoard() {
  const board = state.room?.board || [];
  elements.board.innerHTML = "";

  if (!board.length) {
    elements.board.className = "board empty";
    elements.board.style.removeProperty("--cols");
    elements.board.innerHTML = `<div class="empty-state">先加入房间，设置人数、数字区间和图纸数量，然后开始找数字。</div>`;
    return;
  }

  elements.board.className = "board";
  elements.board.style.setProperty("--cols", columnsFor(board.length));
  const canPlay = state.room.phase === "playing" && state.player;

  for (const item of board) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `cell${item.found ? " found" : ""}`;
    cell.textContent = item.number;
    cell.disabled = !canPlay || item.found;
    cell.addEventListener("click", () => claim(item.id));
    fitCellText(cell, item.number);
    elements.board.append(cell);
  }
}

function render() {
  if (!state.room) return;
  elements.roomCode.textContent = state.room.id;
  elements.currentTarget.textContent = state.room.currentTarget ?? "-";
  elements.progress.textContent = `${state.room.currentIndex} / ${state.room.targets.length}`;
  elements.phaseLabel.textContent = phaseText(state.room.phase);
  elements.startBtn.disabled = state.room.phase === "playing";
  elements.endBtn.disabled = state.room.phase !== "playing";
  elements.resetBtn.disabled = state.room.phase === "playing";
  elements.copyLinkBtn.disabled = !state.room.id;

  for (const button of elements.playerCap.querySelectorAll("button")) {
    button.classList.toggle("active", Number(button.dataset.value) === state.playerCap);
  }

  renderPlayers();
  renderBoard();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

async function join(event) {
  event.preventDefault();
  try {
    if (!state.room) return;
    const data = await api(`/api/rooms/${state.room.id}/join`, {
      name: elements.playerName.value
    });
    state.player = data.player;
    localStorage.setItem(`findNumberPlayer:${state.room.id}`, JSON.stringify(state.player));
    setMessage("已加入，可以开始找数字了。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

async function start(event) {
  event.preventDefault();
  try {
    if (!state.room) return;
    const data = {
      maxPlayers: state.playerCap,
      min: elements.minNumber.value,
      max: elements.maxNumber.value,
      count: elements.numberCount.value
    };
    await api(`/api/rooms/${state.room.id}/start`, data);
    setMessage("图纸已生成。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

async function claim(cellId) {
  try {
    await api(`/api/rooms/${state.room.id}/claim`, {
      playerId: state.player?.id,
      cellId
    });
    setMessage("找到了，加一分。", true);
  } catch (error) {
    setMessage(error.message);
  }
}

elements.newRoomBtn.addEventListener("click", createRoom);
elements.copyLinkBtn.addEventListener("click", async () => {
  if (!state.room) return;
  await navigator.clipboard.writeText(roomLink());
  setMessage("邀请链接已复制。", true);
});
elements.joinForm.addEventListener("submit", join);
elements.settingsForm.addEventListener("submit", start);
elements.endBtn.addEventListener("click", async () => {
  await api(`/api/rooms/${state.room.id}/end`);
});
elements.resetBtn.addEventListener("click", async () => {
  await api(`/api/rooms/${state.room.id}/reset`);
});
elements.playerCap.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.playerCap = Number(button.dataset.value);
  render();
  if (state.room?.phase === "lobby") {
    api(`/api/rooms/${state.room.id}/config`, { maxPlayers: state.playerCap }).catch((error) => {
      state.playerCap = state.room.maxPlayers;
      render();
      setMessage(error.message);
    });
  }
});

const roomFromUrl = params.get("room");
if (roomFromUrl) {
  connect(roomFromUrl.toUpperCase());
} else {
  createRoom();
}
