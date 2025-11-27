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
let simHour = 6; // empezamos a las 06:00 (día)

let canvas, ctx;
let grid = [];
let selectedAsset = null;
let energyPhase = 0; // para animar el "líquido" verde

// Estado jugador
let player = {
  id: "local-player",
  name: "Luigi",
  points: 200,
  windMW: 0,
  storageMWh: 0,
  // energía acumulada
  energyTodayMWh: 0,     // total
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

    // asegurar estructura
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

    initUI();
    drawGrid();

    // producción cada 5s
    setInterval(updateProduction, 5000);

    // animación de energía en cables ~8 fps
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

function initUI() {
  // botones de build
  document.querySelectorAll(".build-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedAsset = btn.dataset.asset;
    });
  });

  // botón reset
  const resetBtn = document.getElementById("btn-reset-park");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const ok = confirm("¿Seguro que quieres resetear todo el parque?");
      if (!ok) return;

      await resetGridOnServer();
      initGrid();

      player.points = 200;
      player.windMW = 0;
      player.storageMWh = 0;
      player.energyTodayMWh = 0;
      player.co2Tons = 0;

      updatePanels();
      drawGrid();
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
    const hoverInfo = document.getElementById("hover-info");
    hoverInfo.classList.add("hidden");
  });

  updatePanels();
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
  const candidates = ["cable", "substation", "turbine_3", "turbine_5", "solar"];

  if (inBounds(x, y - 1)) {
    const c = grid[y - 1][x];
    if (c && candidates.includes(c.type)) dirs.up = true;
  }
  if (inBounds(x, y + 1)) {
    const c = grid[y + 1][x];
    if (c && candidates.includes(c.type)) dirs.down = true;
  }
  if (inBounds(x - 1, y)) {
    const c = grid[y][x - 1];
    if (c && candidates.includes(c.type)) dirs.left = true;
  }
  if (inBounds(x + 1, y)) {
    const c = grid[y][x + 1];
    if (c && candidates.includes(c.type)) dirs.right = true;
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

  // MODO BULLDOZER
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

  // Aviso si es generador y no tiene conexión mínima
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
// DIBUJO GRID + ASSETS
// =========================
function drawGrid() {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.strokeStyle = "rgba(15,23,42,0.6)";
  ctx.lineWidth = 0.4;

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      drawAsset(grid[y][x].type, x, y);
    }
  }

  ctx.restore();
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

  // CABLE con conexiones + energía
  if (type === "cable") {
    const { up, down, left, right } = getCableConnections(x, y);
    const half = CELL_SIZE / 2 - 1;

    // base gris
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

    // nodo central
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.3, 0, Math.PI * 2);
    ctx.stroke();

    // "líquido" verde si está energizado
    if (cell && cell.energized) {
      ctx.save();
      ctx.strokeStyle = "#22c55e"; // verde fosforito
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -energyPhase * 4; // hace que se mueva

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
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + 2);
    ctx.lineTo(cx + 7, cy - 2);
    ctx.lineTo(cx + 5, cy - 7);
    ctx.lineTo(cx - 9, cy - 3);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = "#94a3b8";
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
  // reset flags
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

  // subestaciones → BFS a través de cables
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") {
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const ncell = grid[ny][nx];
          if (!ncell || ncell.type !== "cable") continue;
          if (dist[ny][nx] > 1) {
            dist[ny][nx] = 1;
            queue.push({ x: nx, y: ny });
          }
        }
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
      if (!ncell || ncell.type !== "cable") continue;
      if (dist[ny][nx] > d + 1) {
        dist[ny][nx] = d + 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  // cables energizados si son alcanzables desde alguna subestación
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || cell.type !== "cable") continue;
      cell.energized = dist[y][x] < Infinity;
    }
  }

  // turbinas conectadas?
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.type.startsWith("turbine")) continue;

      let bestDist = Infinity;

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ncell = grid[ny][nx];
        if (!ncell || ncell.type !== "cable") continue;
        if (dist[ny][nx] < bestDist) {
          bestDist = dist[ny][nx];
        }
      }

      if (bestDist < Infinity) {
        cell.connected = true;
        cell.distToSub = bestDist;
      } else {
        cell.connected = false;
        cell.distToSub = null;
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

  let numSubstations = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") numSubstations++;
    }
  }

  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  const capacityPerSub = profile.substationMW;
  const substationCapacityMW = numSubstations * capacityPerSub;

  let connectedMW = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.connected) continue;
      if (cell.type === "turbine_3") connectedMW += 3;
      if (cell.type === "turbine_5") connectedMW += 5;
    }
  }

  let capacityFactor = 1;
  if (substationCapacityMW > 0 && connectedMW > substationCapacityMW) {
    capacityFactor = substationCapacityMW / connectedMW;
  }

  let base = 0;

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || cell.owner !== player.id || !cell.connected) continue;

      let basePerTick = 0;
      if (cell.type === "turbine_3") basePerTick = 2;
      if (cell.type === "turbine_5") basePerTick = 4;
      if (!basePerTick) continue;

      const wakeFactor = computeWakeFactor(x, y);
      const cableFactor = computeCableLossFactor(cell.distToSub);
      const windFactor = profile.windFactor;

      const localProd =
        basePerTick * windFactor * wakeFactor * cableFactor * capacityFactor;

      base += localProd;
    }
  }

  const bessBonus = player.storageMWh > 0 ? 0.05 : 0;
  const produced = base * (1 + bessBonus);

  player.energyTodayMWh += produced;
  player.co2Tons += produced * 0.0003;
  player.points += Math.round(produced / 2);

  updatePanels();
  drawGrid();
}

// =========================
// PANEL STATS
// =========================
  // Cabecera (energías)
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

  // Park stats (capacidad instalada + almacén + total energía)
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
    bonusEl.textContent = "Zona: " + currentZone;
  }
}




