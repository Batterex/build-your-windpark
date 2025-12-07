// =========================
// CONFIG BÁSICA
// =========================
const GRID_SIZE = 40;
const CELL_SIZE = 20;

// Perfiles de zona
const ZONE_PROFILES = {
  polar_norte: {
    windFactor: 1.2,
    substationMW: 60,
    cableLossPerPixel: 0.004,
    maxCableLoss: 0.25,
  },
  templado_norte: {
    windFactor: 1.0,
    substationMW: 50,
    cableLossPerPixel: 0.005,
    maxCableLoss: 0.3,
  },
  tropical: {
    windFactor: 0.9,
    substationMW: 45,
    cableLossPerPixel: 0.006,
    maxCableLoss: 0.3,
  },
  templado_sur: {
    windFactor: 1.0,
    substationMW: 50,
    cableLossPerPixel: 0.005,
    maxCableLoss: 0.3,
  },
  polar_sur: {
    windFactor: 1.1,
    substationMW: 55,
    cableLossPerPixel: 0.0045,
    maxCableLoss: 0.25,
  },
  desconocida: {
    windFactor: 1.0,
    substationMW: 50,
    cableLossPerPixel: 0.005,
    maxCableLoss: 0.3,
  },
};

let currentZone = "desconocida";

let canvas, ctx;
let grid = [];
let selectedAsset = null;
let energyPhase = 0; // animación cables
let simHour = 6; // reloj (06:00)

// Matriz de orografía
let terrain = [];

// Estado del jugador
const storedName = window.localStorage
  ? window.localStorage.getItem("byrp_player_name")
  : null;

let player = {
  id: "local-player",
  name: storedName || "Luigi",
  points: 200,
  windMW: 0,
  storageMWh: 0,
  energyTodayMWh: 0,
  windEnergyMWh: 0,
  solarEnergyMWh: 0,
  bessEnergyMWh: 0,
  co2Tons: 0,
};

// =========================
// INICIALIZACIÓN
// =========================
document.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d");

  const params = new URLSearchParams(window.location.search);
  const tileX = parseInt(params.get("tileX") || "0", 10);
  const tileY = parseInt(params.get("tileY") || "0", 10);
  currentZone = params.get("zone") || "desconocida";
  console.log("Tablero para pixel:", tileX, tileY, "zona:", currentZone);

  fetchGridFromServer().then((serverGrid) => {
    if (serverGrid && Array.isArray(serverGrid) && serverGrid.length === GRID_SIZE) {
      grid = serverGrid;
    } else {
      initGrid();
    }

    // asegurar estructura de cada celda
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (!grid[y][x]) {
          grid[y][x] = {
            type: "empty",
            owner: null,
            connected: false,
            distToSub: null,
            energized: false,
          };
        } else {
          if (grid[y][x].connected === undefined) grid[y][x].connected = false;
          if (grid[y][x].distToSub === undefined) grid[y][x].distToSub = null;
          if (grid[y][x].energized === undefined) grid[y][x].energized = false;
        }
      }
    }

    generateTerrainForZone();
    initUI();
    drawGrid();

    setInterval(updateProduction, 5000);

    setInterval(() => {
      energyPhase += 0.4;
      if (energyPhase > 1000) energyPhase = 0;
      drawGrid();
    }, 120);
  });
});

function initGrid() {
  grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      type: "empty",
      owner: null,
      connected: false,
      distToSub: null,
      energized: false,
    }))
  );
}

// =========================
// OROGRAFÍA
// =========================
function generateTerrainForZone() {
  terrain = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ type: "plain" }))
  );

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const r = Math.random();
      let t = "plain";

      if (currentZone === "templado_norte" || currentZone === "templado_sur") {
        if (r < 0.65) t = "plain";
        else if (r < 0.85) t = "hilly";
        else if (r < 0.95) t = "mountain";
        else t = "water";
      } else if (currentZone === "tropical") {
        if (r < 0.5) t = "plain";
        else if (r < 0.7) t = "hilly";
        else if (r < 0.75) t = "mountain";
        else t = "water";
      } else if (currentZone === "polar_norte" || currentZone === "polar_sur") {
        if (r < 0.4) t = "plain";
        else if (r < 0.7) t = "mountain";
        else t = "water";
      } else {
        if (r < 0.7) t = "plain";
        else if (r < 0.9) t = "hilly";
        else t = "mountain";
      }

      terrain[y][x].type = t;
    }
  }
}

function isForbiddenTerrainForGenerator(terrainType) {
  return terrainType === "water" || terrainType === "mountain";
}

function getTerrainWindFactor(terrainType) {
  switch (terrainType) {
    case "plain":
      return 1.0;
    case "hilly":
      return 1.05;
    case "mountain":
      return 1.15;
    case "water":
      return 1.1;
    default:
      return 1.0;
  }
}

function drawTerrainBackground(x, y) {
  if (!terrain[y] || !terrain[y][x]) return;
  const t = terrain[y][x].type;
  const baseX = x * CELL_SIZE;
  const baseY = y * CELL_SIZE;

  if (t === "plain") return;

  if (t === "hilly") {
    ctx.fillStyle = "rgba(22, 163, 74, 0.10)";
  } else if (t === "mountain") {
    ctx.fillStyle = "rgba(30, 64, 175, 0.16)";
  } else if (t === "water") {
    ctx.fillStyle = "rgba(15, 118, 110, 0.20)";
  } else {
    return;
  }

  ctx.fillRect(baseX, baseY, CELL_SIZE, CELL_SIZE);
}

// =========================
// SISTEMA DE NIVELES
// =========================
// Usamos el Total RE acumulado (player.energyTodayMWh) para definir el nivel

function getLevelInfo(totalRE) {
  // thresholds en MWh (ajustables)
  if (totalRE < 50) {
    return {
      level: 1,
      label: "Junior Engineer",
      bonusDesc: "Sin bonus. Aprende a construir tu primera central.",
    };
  }
  if (totalRE < 200) {
    return {
      level: 2,
      label: "Plant Engineer",
      bonusDesc: "+5% eficiencia eólica (pronto lo aplicaremos en la física).",
    };
  }
  if (totalRE < 500) {
    return {
      level: 3,
      label: "Senior Engineer",
      bonusDesc: "-5% pérdidas en cableado (se activará más adelante).",
    };
  }
  if (totalRE < 1000) {
    return {
      level: 4,
      label: "Grid Specialist",
      bonusDesc: "+10% capacidad de subestaciones.",
    };
  }
  return {
    level: 5,
    label: "System Architect",
    bonusDesc: "Acceso a optimizaciones avanzadas de la planta.",
  };
}

// =========================
// UI
// =========================
function initUI() {
  document.querySelectorAll(".build-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedAsset = btn.dataset.asset;
    });
  });

  // Botón para cambiar el nombre del jugador
  const changeNameBtn = document.getElementById("btn-change-name");
  if (changeNameBtn) {
    changeNameBtn.addEventListener("click", () => {
      const newName = prompt("Escribe tu nombre de jugador:", player.name || "Jugador");
      if (!newName) return;
      player.name = newName;
      if (window.localStorage) {
        window.localStorage.setItem("byrp_player_name", newName);
      }
      updatePanels();
    });
  }

  canvas.addEventListener("click", handleCanvasClick);

  const hoverInfo = document.getElementById("hover-info");
  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = getCellFromEvent(e);
    if (!inBounds(x, y)) {
      hoverInfo.classList.add("hidden");
      return;
    }
    const cell = grid[y][x];
    hoverInfo.style.left = e.offsetX + 15 + "px";
    hoverInfo.style.top = e.offsetY + 15 + "px";
    hoverInfo.textContent = cell.type === "empty" ? "Empty plot – click to build" : cell.type;
    hoverInfo.classList.remove("hidden");
  });

  canvas.addEventListener("mouseleave", () => {
    hoverInfo.classList.add("hidden");
  });

  updatePanels();
}

  // Placeholders para Leaderboard y Login/Signup
  const leaderBtn = document.getElementById("btn-leaderboard");
  if (leaderBtn) {
    leaderBtn.addEventListener("click", () => {
      alert("Leaderboard aún no está disponible.\n\nEn el futuro verás aquí el ranking de centrales más eficientes.");
    });
  }

  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      alert("Login / Signup aún no está disponible.\n\nMás adelante podrás guardar tus centrales y competir con otros jugadores.");
    });
  }

// =========================
// HELPERS
// =========================
function getCellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
  const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);
  return { x, y };
}

function inBounds(x, y) {
  return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

function hasNeighborConnection(x, y) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const ncell = grid[ny][nx];
    if (!ncell) continue;
    if (ncell.type === "cable" || ncell.type === "substation") return true;
  }
  return false;
}

function getCableConnections(x, y) {
  const dirs = { up: false, down: false, left: false, right: false };
  const conductive = ["cable", "substation", "turbine_3", "turbine_5", "solar", "bess_10"];

  if (inBounds(x, y - 1)) {
    const c = grid[y - 1][x];
    if (c && conductive.includes(c.type)) dirs.up = true;
  }
  if (inBounds(x, y + 1)) {
    const c = grid[y + 1][x];
    if (c && conductive.includes(c.type)) dirs.down = true;
  }
  if (inBounds(x - 1, y)) {
    const c = grid[y][x - 1];
    if (c && conductive.includes(c.type)) dirs.left = true;
  }
  if (inBounds(x + 1, y)) {
    const c = grid[y][x + 1];
    if (c && conductive.includes(c.type)) dirs.right = true;
  }
  return dirs;
}

// =========================
// CLICK / CONSTRUCCIÓN
// =========================
function handleCanvasClick(e) {
  if (!selectedAsset) return;
  const { x, y } = getCellFromEvent(e);
  if (!inBounds(x, y)) return;

  const cell = grid[y][x];

  // Bulldozer
  if (selectedAsset === "bulldozer") {
    if (cell.type !== "empty") {
      const originalCost = getAssetCost(cell.type);
      const refund = Math.round(originalCost / 2);
      player.points += refund;
      removeAssetStats(cell.type);

      cell.type = "empty";
      cell.owner = null;
      cell.connected = false;
      cell.distToSub = null;
      cell.energized = false;

      drawGrid();
      updatePanels();

      updateCellOnServer(x, y, "empty", null);
    }
    return;
  }

  // Construcción normal
  if (cell.type !== "empty") return;

  const terrType = terrain[y][x]?.type || "plain";
  if (
    (selectedAsset === "turbine_3" ||
      selectedAsset === "turbine_5" ||
      selectedAsset === "solar") &&
    isForbiddenTerrainForGenerator(terrType)
  ) {
    alert(
      "No puedes instalar este generador en este tipo de terreno.\n" +
        "Prueba en una celda más llana o adecuada."
    );
    return;
  }

  const cost = getAssetCost(selectedAsset);
  if (player.points < cost) {
    alert("Not enough points!");
    return;
  }

  player.points -= cost;

  cell.type = selectedAsset;
  cell.owner = player.id;
  cell.connected = false;
  cell.distToSub = null;
  cell.energized = false;

  applyAssetStats(selectedAsset);

  if (
    (selectedAsset === "turbine_3" ||
      selectedAsset === "turbine_5" ||
      selectedAsset === "solar") &&
    !hasNeighborConnection(x, y)
  ) {
    alert(
      "Este generador todavía NO producirá energía.\n\n" +
        "Debe estar conectado mediante CABLE a una SUBESTACIÓN para evacuar la energía."
    );
  }

  drawGrid();
  updatePanels();

  updateCellOnServer(x, y, cell.type, cell.owner);
}

// =========================
// DIBUJO
// =========================
function drawGrid() {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      drawTerrainBackground(x, y);
      drawAsset(grid[y][x].type, x, y);
    }
  }
}

function drawAsset(type, x, y) {
  const cx = x * CELL_SIZE + CELL_SIZE / 2;
  const cy = y * CELL_SIZE + CELL_SIZE / 2;
  const cell = grid[y][x];

  if (!type || type === "empty") return;

  // TURBINAS
  if (type.startsWith("turbine")) {
    const isConnected = cell && cell.connected;

    ctx.strokeStyle = isConnected ? "#e5e7eb" : "#f97316";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 6);
    ctx.lineTo(cx, cy - 4);
    ctx.stroke();

    ctx.fillStyle = isConnected ? "#94a3b8" : "#fb923c";
    ctx.fillRect(cx - 4, cy + 6, 8, 3);

    ctx.fillStyle = isConnected ? "#e5e7eb" : "#fed7aa";
    ctx.fillRect(cx - 3, cy - 7, 6, 4);

    ctx.beginPath();
    ctx.arc(cx, cy - 5, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isConnected ? "#e5e7eb" : "#fed7aa";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx - 7, cy - 11);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 8, cy - 9);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 3);
    ctx.stroke();
    return;
  }

  // BESS
  if (type.startsWith("bess")) {
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.4;
    ctx.fillRect(cx - 7, cy - 5, 14, 10);
    ctx.strokeRect(cx - 7, cy - 5, 14, 10);

    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(cx - 4, cy - 7, 8, 2);

    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 3);
    ctx.lineTo(cx - 2, cy + 1);
    ctx.lineTo(cx, cy + 1);
    ctx.lineTo(cx - 1, cy + 5);
    ctx.lineTo(cx + 2, cy + 1);
    ctx.lineTo(cx, cy + 1);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // SUBESTACIÓN
  if (type === "substation") {
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.4;
    ctx.fillRect(cx - 7, cy - 5, 14, 10);
    ctx.strokeRect(cx - 7, cy - 5, 14, 10);

    ctx.fillStyle = "#fbbf24";
    ctx.globalAlpha = 0.35;
    ctx.fillRect(cx - 5, cy - 3, 4, 6);
    ctx.fillRect(cx + 1, cy - 3, 4, 6);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx - 2, cy + 1);
    ctx.lineTo(cx, cy + 1);
    ctx.lineTo(cx - 1, cy + 5);
    ctx.lineTo(cx + 2, cy);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // CABLE
  if (type === "cable") {
    const { up, down, left, right } = getCableConnections(x, y);
    const half = CELL_SIZE / 2 - 1;

    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.6;
    ctx.beginPath();

    if (!up && !down && !left && !right) {
      ctx.moveTo(cx - 2, cy);
      ctx.lineTo(cx + 2, cy);
      ctx.stroke();
    } else {
      if (up) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy - half);
      }
      if (down) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + half);
      }
      if (left) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - half, cy);
      }
      if (right) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + half, cy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.3, 0, Math.PI * 2);
    ctx.stroke();

    if (cell && cell.energized) {
      ctx.save();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -energyPhase * 4;

      ctx.beginPath();
      if (!up && !down && !left && !right) {
        ctx.moveTo(cx - 2, cy);
        ctx.lineTo(cx + 2, cy);
      } else {
        if (up) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy - half);
        }
        if (down) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + half);
        }
        if (left) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx - half, cy);
        }
        if (right) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + half, cy);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  // MET MAST
  if (type === "metmast") {
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 4, cy + 7);
    ctx.lineTo(cx + 4, cy + 7);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = "#a855f7";
    ctx.beginPath();
    ctx.arc(cx, cy - 7, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + 5, cy - 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 6, cy - 9.3, 1.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // SOLAR
  if (type === "solar") {
    const isConnected = cell && cell.connected;

    ctx.strokeStyle = isConnected ? "#22c55e" : "#facc15";
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + 2);
    ctx.lineTo(cx + 7, cy - 2);
    ctx.lineTo(cx + 5, cy - 7);
    ctx.lineTo(cx - 9, cy - 3);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = isConnected ? "#bbf7d0" : "#fde68a";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 3);
    ctx.lineTo(cx - 6, cy + 7);
    ctx.moveTo(cx + 4, cy + 1);
    ctx.lineTo(cx + 4, cy + 7);
    ctx.stroke();
    return;
  }
}

// =========================
// COSTES / STATS
// =========================
function getAssetCost(type) {
  switch (type) {
    case "turbine_3":
      return 50;
    case "turbine_5":
      return 80;
    case "bess_10":
      return 40;
    case "substation":
      return 100;
    case "cable":
      return 5;
    case "metmast":
      return 20;
    case "solar":
      return 10;
    default:
      return 0;
  }
}

function applyAssetStats(type) {
  if (type === "turbine_3") player.windMW += 3;
  if (type === "turbine_5") player.windMW += 5;
  if (type === "bess_10") player.storageMWh += 10;
  if (type === "solar") player.windMW += 1;
}

function removeAssetStats(type) {
  if (type === "turbine_3") player.windMW -= 3;
  if (type === "turbine_5") player.windMW -= 5;
  if (type === "bess_10") player.storageMWh -= 10;
  if (type === "solar") player.windMW -= 1;
}

// =========================
// CONEXIONES + PRODUCCIÓN
// =========================
function computeConnectionsAndDistances() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      cell.connected = false;
      cell.distToSub = null;
      cell.energized = false;
    }
  }

  const dist = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => Infinity)
  );

  const queue = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const conductive = ["cable", "turbine_3", "turbine_5", "solar", "bess_10"];

  // semillas: subestaciones
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") {
        dist[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    const d = dist[y][x];

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ncell = grid[ny][nx];
      if (!ncell || !conductive.includes(ncell.type)) continue;

      const nd = d + 1;
      if (nd < dist[ny][nx]) {
        dist[ny][nx] = nd;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      const d = dist[y][x];

      if (cell.type === "cable") {
        cell.energized = d < Infinity;
      }

      if (
        cell.type === "turbine_3" ||
        cell.type === "turbine_5" ||
        cell.type === "solar"
      ) {
        if (d < Infinity) {
          cell.connected = true;
          cell.distToSub = d;
        } else {
          cell.connected = false;
          cell.distToSub = null;
        }
      }
    }
  }
}

function computeWakeFactor(x, y) {
  let upstream = 0;
  const maxRange = 6;

  for (let dy = 1; dy <= maxRange; dy++) {
    const ny = y - dy;
    if (!inBounds(x, ny)) break;
    const cell = grid[ny][x];
    if (!cell || !cell.connected) continue;
    if (cell.type === "turbine_3" || cell.type === "turbine_5") upstream++;
  }

  const factor = 1 - 0.1 * upstream;
  return Math.max(0.4, factor);
}

function computeCableLossFactor(distToSub) {
  if (distToSub == null) return 1;
  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  const lossPerPixel = profile.cableLossPerPixel;
  const maxLoss = profile.maxCableLoss;
  const loss = Math.min(maxLoss, distToSub * lossPerPixel);
  return 1 - loss;
}

function updateProduction() {
  computeConnectionsAndDistances();

  simHour = (simHour + 1) % 24;
  const isDay = simHour >= 6 && simHour < 18;

  let numSubstations = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") numSubstations++;
    }
  }

  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  const capacityPerSubstation = profile.substationMW;
  const substationCapacityMW = numSubstations * capacityPerSubstation;

  let connectedWindMW = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.connected) continue;
      if (cell.type === "turbine_3") connectedWindMW += 3;
      if (cell.type === "turbine_5") connectedWindMW += 5;
    }
  }

  let capacityFactor = 1;
  if (substationCapacityMW > 0 && connectedWindMW > substationCapacityMW) {
    capacityFactor = substationCapacityMW / connectedWindMW;
  }

  let windProduced = 0;
  let solarProduced = 0;
  let bessProduced = 0; // aún no implementado

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || cell.owner !== player.id || !cell.connected) continue;

      const cableFactor = computeCableLossFactor(cell.distToSub);
      const terrType = terrain[y][x]?.type || "plain";

      if (cell.type === "turbine_3" || cell.type === "turbine_5") {
        let basePerTick = 0;
        if (cell.type === "turbine_3") basePerTick = 2;
        if (cell.type === "turbine_5") basePerTick = 4;

        const wakeFactor = computeWakeFactor(x, y);
        const windFactor = profile.windFactor;
        const terrainFactor = getTerrainWindFactor(terrType);

        const localWind =
          basePerTick *
          windFactor *
          terrainFactor *
          wakeFactor *
          cableFactor *
          capacityFactor;

        windProduced += localWind;
      }

      if (cell.type === "solar" && isDay) {
        const baseSolarMW = 0.5; // 0.5 MW por celda
        const solarFactorZone = 1.0;
        const solarFactorTerrain = 1.0;
        const localSolar =
          baseSolarMW * solarFactorZone * solarFactorTerrain * cableFactor;

        solarProduced += localSolar;
      }
    }
  }

  player.windEnergyMWh += windProduced;
  player.solarEnergyMWh += solarProduced;
  player.bessEnergyMWh += bessProduced;

  const totalProduced = windProduced + solarProduced + bessProduced;

  player.energyTodayMWh += totalProduced;
  player.co2Tons += totalProduced * 0.0003;
  player.points += Math.round(totalProduced / 2);

  updatePanels();
  drawGrid();
}

// =========================
// PANEL STATS
// =========================
function updatePanels() {
  const totalRE =
    player.windEnergyMWh + player.solarEnergyMWh + player.bessEnergyMWh;

  const windStat = document.getElementById("stat-wind-energy");
  const solarStat = document.getElementById("stat-solar-energy");
  const bessStat = document.getElementById("stat-bess-energy");
  const totalStat = document.getElementById("stat-total-energy");
  const timeStat = document.getElementById("stat-time");

  if (windStat) windStat.textContent = player.windEnergyMWh.toFixed(1);
  if (solarStat) solarStat.textContent = player.solarEnergyMWh.toFixed(1);
  if (bessStat) bessStat.textContent = player.bessEnergyMWh.toFixed(1);
  if (totalStat) totalStat.textContent = totalRE.toFixed(1);
  if (timeStat) {
    const h = simHour.toString().padStart(2, "0");
    timeStat.textContent = `${h}:00`;
  }

  document.getElementById("park-installed").textContent =
    player.windMW.toFixed(0);
  document.getElementById("park-storage").textContent =
    player.storageMWh.toFixed(0);
  document.getElementById("park-energy").textContent =
    player.energyTodayMWh.toFixed(1);
  document.getElementById("park-co2").textContent =
    player.co2Tons.toFixed(2);

  document.getElementById("player-name").textContent = player.name;
  document.getElementById("player-points").textContent =
    player.points.toFixed(0);

  const bonusEl = document.getElementById("player-bonus");
  if (bonusEl) {
    let zoneText = currentZone;
    if (currentZone === "templado_norte" || currentZone === "templado_sur") {
      zoneText = "Temperate (templado)";
    } else if (currentZone === "tropical") {
      zoneText = "Tropical";
    } else if (currentZone === "polar_norte" || currentZone === "polar_sur") {
      zoneText = "Polar";
    }

    // descripción simple de bonus por zona
    let zoneBonus = "";
    if (currentZone === "tropical") {
      zoneBonus = "Buen solar, viento medio.";
    } else if (currentZone === "polar_norte" || currentZone === "polar_sur") {
      zoneBonus = "Viento fuerte, sol bajo.";
    } else {
      zoneBonus = "Condiciones equilibradas.";
    }

    bonusEl.textContent = `Zona: ${zoneText} – ${zoneBonus}`;
  }
}





