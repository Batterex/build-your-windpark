// =========================
// CONFIG BÁSICA
// =========================
const GRID_SIZE = 40;
const CELL_SIZE = 20;

// Perfiles de zona (ajustan viento, capacidad, pérdidas, etc.)
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
let energyPhase = 0; // para animar el "líquido" verde
let simHour = 6; // reloj de simulación (06:00 de inicio)
let terrain = []; // misma forma que grid, guarda tipo de terreno por celda

// Estado del jugador
let player = {
  id: "local-player",
  name: "Luigi",
  points: 200,
  windMW: 0,
  storageMWh: 0,
  // energía acumulada
  energyTodayMWh: 0, // total
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

    initUI();
    drawGrid();

    // producción cada 5s
    setInterval(updateProduction, 5000);

    // animación de energía en cables ~8 FPS
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
  // botones de construcción
  document.querySelectorAll(".build-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedAsset = btn.dataset.asset;
    });
  });

  // botón Reset park
  const resetBtn = document.getElementById("btn-reset-park");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const ok = confirm("¿Seguro que quieres resetear todo el parque?");
      if (!ok) return;

      await resetGridOnServer();
      initGrid();
      generateTerrainForZone();

      player = {
        id: "local-player",
        name: "Luigi",
        points: 200,
        windMW: 0,
        storageMWh: 0,
        energyTodayMWh: 0,
        windEnergyMWh: 0,
        solarEnergyMWh: 0,
        bessEnergyMWh: 0,
        co2Tons: 0,
      };
      simHour = 6;

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

// ¿Tiene al menos un cable o subestación al lado?
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

// Saber hacia dónde está conectado el cable (para dibujarlo)
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
// OROGRAFÍA
// =========================

function generateTerrainForZone() {
  terrain = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      type: "plain", // plain, hilly, mountain, water
    }))
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
        // desconocida
        if (r < 0.7) t = "plain";
        else if (r < 0.9) t = "hilly";
        else t = "mountain";
      }

      terrain[y][x].type = t;
    }
  }
}

// algunas celdas NO permiten turbinas/solar
function isForbiddenTerrainForGenerator(terrainType) {
  // por ahora: no permitimos turbinas/solar en "water" ni "mountain" (demasiado empinado)
  return terrainType === "water" || terrainType === "mountain";
}

// factor de viento extra según terreno
function getTerrainWindFactor(terrainType) {
  switch (terrainType) {
    case "plain":
      return 1.0;
    case "hilly":
      return 1.05;
    case "mountain":
      return 1.15; // mejor viento en montes
    case "water":
      return 1.1;  // offshore suele ser bueno
    default:
      return 1.0;
  }
}

// dibujar fondo de terreno (muy sutil)
function drawTerrainBackground(x, y) {
  if (!terrain[y] || !terrain[y][x]) return;
  const t = terrain[y][x].type;

  const baseX = x * CELL_SIZE;
  const baseY = y * CELL_SIZE;

  if (t === "plain") {
    return; // nada especial
  }

  if (t === "hilly") {
    ctx.fillStyle = "rgba(22, 163, 74, 0.10)"; // ligero verde
  } else if (t === "mountain") {
    ctx.fillStyle = "rgba(30, 64, 175, 0.16)"; // azulado fuerte
  } else if (t === "water") {
    ctx.fillStyle = "rgba(15, 118, 110, 0.20)"; // turquesa
  } else {
    return;
  }

  ctx.fillRect(baseX, baseY, CELL_SIZE, CELL_SIZE);
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

  // si es turbina o solar, comprobar terreno
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
  // Fondo general
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Recorremos todas las celdas
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Fondo orográfico por celda (agua, montaña, colinas...)
      if (typeof drawTerrainBackground === "function") {
        drawTerrainBackground(x, y);
      }

      // Dibujar el asset (turbina, cable, solar, etc.)
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

  // SOLAR (amarillo sin conexión, verde conectado)
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
  if (type === "solar") player.windMW += 1; // simplificado
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
  // Reset flags
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

  // Semillas: todas las subestaciones
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") {
        dist[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }

  // BFS para propagar distancias
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

  // Aplicar distancias
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
  const maxLoss = profile.maxLoss ?? profile.maxCableLoss;
  const loss = Math.min(maxLoss, distToSub * lossPerPixel);
  return 1 - loss;
}

function updateProduction() {
  computeConnectionsAndDistances();

  // avanzar reloj (1h por tick)
  simHour = (simHour + 1) % 24;
  const isDay = simHour >= 6 && simHour < 18;

  let numSubstations = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") numSubstations++;
    }
  }

  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  const capacityPerSub = profile.substationMW;
  const substationCapacityMW = numSubstations * capacityPerSub;

  // MW de viento conectados (solo turbinas)
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
  let bessProduced = 0; // pendiente de implementar como generador

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || cell.owner !== player.id || !cell.connected) continue;

      const cableFactor = computeCableLossFactor(cell.distToSub);

      // viento (turbinas)
      if (cell.type === "turbine_3" || cell.type === "turbine_5") {
        let basePerTick = 0;
        if (cell.type === "turbine_3") basePerTick = 2;
        if (cell.type === "turbine_5") basePerTick = 4;

        const wakeFactor = computeWakeFactor(x, y);
        const windFactor = profile.windFactor;
        const terrType = terrain[y][x]?.type || "plain";
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


// SOLAR (0,5 MW por celda, solo de día)
if (cell.type === "solar") {
  const baseSolarMW = 0.5; // potencia instalada solar por celda

  if (isDay && cell.connected) {
    // de día produce
    const solarFactorZone = 1.0; // luego lo afinamos por zona
    const solarFactorTerrain = 1.0; // también podemos ajustarlo luego

    // producción solar en este tick:
    // producción = MW * factores * eficiencia por cable
    const localSolar =
      baseSolarMW * solarFactorZone * solarFactorTerrain * cableFactor;

    solarProduced += localSolar;
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

  // Park stats
  document.getElementById("park-installed").textContent =
    player.windMW.toFixed(0);
  document.getElementById("park-storage").textContent =
    player.storageMWh.toFixed(0);
  document.getElementById("park-energy").textContent =
    player.energyTodayMWh.toFixed(1);
  document.getElementById("park-co2").textContent =
    player.co2Tons.toFixed(2);

  // Panel de jugador
  document.getElementById("player-name").textContent = player.name;
  document.getElementById("player-points").textContent =
    player.points.toFixed(0);

  const bonusEl = document.getElementById("player-bonus");
  if (bonusEl) {
    bonusEl.textContent = "Zona: " + currentZone;
  }
}









