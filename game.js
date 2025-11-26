// Config básica
const GRID_SIZE = 40;
const CELL_SIZE = 20;

// Perfiles de zona (ajustan viento, capacidad, pérdidas, etc.)
const ZONE_PROFILES = {
  polar_norte: {
    windFactor: 1.2,
    substationMW: 60,        // MW por subestación
    cableLossPerPixel: 0.004,
    maxCableLoss: 0.25
  },
  templado_norte: {
    windFactor: 1.0,
    substationMW: 50,
    cableLossPerPixel: 0.005,
    maxCableLoss: 0.30
  },
  tropical: {
    windFactor: 0.9,
    substationMW: 45,
    cableLossPerPixel: 0.006,
    maxCableLoss: 0.30
  },
  templado_sur: {
    windFactor: 1.0,
    substationMW: 50,
    cableLossPerPixel: 0.005,
    maxCableLoss: 0.30
  },
  polar_sur: {
    windFactor: 1.1,
    substationMW: 55,
    cableLossPerPixel: 0.0045,
    maxCableLoss: 0.25
  },
  desconocida: {
    windFactor: 1.0,
    substationMW: 50,
    cableLossPerPixel: 0.005,
    maxCableLoss: 0.30
  }
};

// Zona actual del tablero (se rellena al iniciar)
let currentZone = "desconocida";

let canvas, ctx;
let grid = [];
let selectedAsset = null;

// Estado básico de jugador
let player = {
  id: "local-player",
  name: "Luigi",
  points: 200,
  windMW: 0,
  storageMWh: 0,
  energyTodayMWh: 0,
  co2Tons: 0,
};

document.addEventListener("DOMContentLoaded", () => {
    // Leer parámetros de la URL (tileX, tileY, zone)
  const params = new URLSearchParams(window.location.search);
  const tileX = parseInt(params.get("tileX") || "0", 10);
  const tileY = parseInt(params.get("tileY") || "0", 10);
  currentZone = params.get("zone") || "desconocida";
  
  console.log("Tablero cargado para pixel:", tileX, tileY, "zona:", zone);

  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d");

  // Intentar cargar grid desde backend
  fetchGridFromServer().then((serverGrid) => {
    if (serverGrid && Array.isArray(serverGrid) && serverGrid.length === GRID_SIZE) {
      grid = serverGrid;
    } else {
      initGrid();
    }

    // Asegurar estructura de cada celda
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (!grid[y][x]) {
          grid[y][x] = { type: "empty", owner: null, connected: false, distToSub: null };
        } else {
          if (grid[y][x].connected === undefined) grid[y][x].connected = false;
          if (grid[y][x].distToSub === undefined) grid[y][x].distToSub = null;
        }
      }
    }

    initUI();
    drawGrid();

    // Tick de producción
    setInterval(updateProduction, 5000);
  });
});

function initGrid() {
  grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      type: "empty",
      owner: null,
      connected: false,
      distToSub: null,
    }))
  );
}

function initUI() {
  // Botones de build
  document.querySelectorAll(".build-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedAsset = btn.dataset.asset;
    });
  });

    // Botón Reset park
  const resetBtn = document.getElementById("btn-reset-park");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const ok = confirm("¿Seguro que quieres resetear todo el parque?");
      if (!ok) return;

      // Reset en backend
      await resetGridOnServer();

      // Reset local del grid
      initGrid();

      // Reset stats de jugador
      player.points = 200;
      player.windMW = 0;
      player.storageMWh = 0;
      player.energyTodayMWh = 0;
      player.co2Tons = 0;

      updatePanels();
      drawGrid();
    });
  }
  
  // Click en canvas
  canvas.addEventListener("click", handleCanvasClick);

  // Hover info
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
    hoverInfo.textContent =
      cell.type === "empty" ? "Empty plot – click to build" : cell.type;
    hoverInfo.classList.remove("hidden");
  });

  canvas.addEventListener("mouseleave", () => {
    const hoverInfo = document.getElementById("hover-info");
    hoverInfo.classList.add("hidden");
  });

  updatePanels();
}

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
    if (ncell.type === "cable" || ncell.type === "substation") {
      return true;
    }
  }
  return false;
}

function handleCanvasClick(e) {
  if (!selectedAsset) return;
  const { x, y } = getCellFromEvent(e);
  if (!inBounds(x, y)) return;

  const cell = grid[y][x];

// MODO BULLDOZER: borrar lo que haya en la celda
if (selectedAsset === "bulldozer") {
  if (cell.type !== "empty") {
    // calcular la devolución (mitad del coste original)
    const originalCost = getAssetCost(cell.type);
    const refund = Math.round(originalCost / 2);

    // devolver puntos al jugador (hasta máximo 999999 por seguridad, opcional)
    player.points += refund;

    // restar estadísticas según lo que quitamos
    removeAssetStats(cell.type);

    // vaciar celda
    cell.type = "empty";
    cell.owner = null;
    cell.connected = false;
    cell.distToSub = null;

    drawGrid();
    updatePanels();

    // Guardar en backend (vaciar celda)
    updateCellOnServer(x, y, "empty", null);
  }
  return;
}


  // MODO CONSTRUCCIÓN NORMAL
  if (cell.type !== "empty") return; // ya ocupado

  const cost = getAssetCost(selectedAsset);
  if (player.points < cost) {
    alert("Not enough points!");
    return;
  }

  // Pagar
  player.points -= cost;

  // Colocar
  cell.type = selectedAsset;
  cell.owner = player.id;
  cell.connected = false;
  cell.distToSub = null;

  applyAssetStats(selectedAsset);

  // Avisos de conexión mínima para turbinas y solar
  if (
    (selectedAsset === "turbine_3" || selectedAsset === "turbine_5" || selectedAsset === "solar") &&
    !hasNeighborConnection(x, y)
  ) {
    alert(
      "Este generador todavía NO producirá energía.\n\n" +
      "Debe estar conectado mediante CABLE a una SUBESTACIÓN para evacuar la energía."
    );
  }

  drawGrid();
  updatePanels();

  // Guardar también en backend
  updateCellOnServer(x, y, cell.type, cell.owner);
}


function drawGrid() {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.strokeStyle = "rgba(15,23,42,0.6)"; // gris muy oscuro con algo de transparencia
  ctx.lineWidth = 0.4;                    // línea muy fina

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      drawAsset(grid[y][x].type, x, y);
    }
  }

  ctx.restore();
}


// Dibuja iconos
function drawAsset(type, x, y) {
  const cx = x * CELL_SIZE + CELL_SIZE / 2;
  const cy = y * CELL_SIZE + CELL_SIZE / 2;
  const cell = grid[y][x];

  if (!type || type === "empty") return;

  // TURBINAS: estilo torre + nacelle, blanco si conectada, naranja si no
  if (type.startsWith("turbine")) {
    const isConnected = cell && cell.connected;

    // torre
    ctx.strokeStyle = isConnected ? "#e5e7eb" : "#f97316";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 6);
    ctx.lineTo(cx, cy - 4);
    ctx.stroke();

    // base
    ctx.fillStyle = isConnected ? "#94a3b8" : "#fb923c";
    ctx.fillRect(cx - 4, cy + 6, 8, 3);

    // nacelle
    ctx.fillStyle = isConnected ? "#e5e7eb" : "#fed7aa";
    ctx.fillRect(cx - 3, cy - 7, 6, 4);

    // rotor
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 2.4, 0, Math.PI * 2);
    ctx.fill();

    // palas
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

  // BESS (batería / contenedor)
  if (type.startsWith("bess")) {
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.4;
    ctx.fillRect(cx - 7, cy - 5, 14, 10);
    ctx.strokeRect(cx - 7, cy - 5, 14, 10);

    // tapa
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(cx - 4, cy - 7, 8, 2);

    // rayo
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

    // ventanitas
    ctx.fillStyle = "#fbbf24";
    ctx.globalAlpha = 0.35;
    ctx.fillRect(cx - 5, cy - 3, 4, 6);
    ctx.fillRect(cx + 1, cy - 3, 4, 6);
    ctx.globalAlpha = 1;

    // rayo alto voltaje
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
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.stroke();

    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 3);
    ctx.lineTo(cx - 5, cy + 3);
    ctx.moveTo(cx, cy - 3);
    ctx.lineTo(cx, cy + 3);
    ctx.moveTo(cx + 5, cy - 3);
    ctx.lineTo(cx + 5, cy + 3);
    ctx.stroke();
    return;
  }

  // MET MAST
  if (type === "metmast") {
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.4;

    // torre triangular
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 4, cy + 7);
    ctx.lineTo(cx + 4, cy + 7);
    ctx.closePath();
    ctx.stroke();

    // cabeza
    ctx.fillStyle = "#a855f7";
    ctx.beginPath();
    ctx.arc(cx, cy - 7, 2, 0, Math.PI * 2);
    ctx.fill();

    // anemómetro
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

    // estructura
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
  if (type === "solar") player.windMW += 1; // simplificación
}

// Nueva: revertir stats al borrar un asset
function removeAssetStats(type) {
  if (type === "turbine_3") player.windMW -= 3;
  if (type === "turbine_5") player.windMW -= 5;
  if (type === "bess_10") player.storageMWh -= 10;
  if (type === "solar") player.windMW -= 1;
}

/**
 * Calcula distancias desde subestaciones a cables (BFS)
 * y marca qué turbinas están realmente conectadas.
 */
function computeConnectionsAndDistances() {
  // Reset
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      cell.connected = false;
      cell.distToSub = null;
    }
  }

  const dist = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => Infinity)
  );

  const queue = [];

  // Inicializar BFS desde todas las subestaciones
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") {
        // Desde substation miramos cables adyacentes
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
          if (!ncell || ncell.type !== "cable") continue;
          if (dist[ny][nx] > 1) {
            dist[ny][nx] = 1;
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }
  }

  // BFS sobre cables
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

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

  // Determinar turbinas conectadas (deben tocar cable con dist válida)
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || (!cell.type.startsWith("turbine"))) continue;

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
        cell.distToSub = bestDist; // nº de pixels de cable hasta substation más cercana
      } else {
        cell.connected = false;
        cell.distToSub = null;
      }
    }
  }
}

// Wake effect: viento de norte a sur (y creciente)
function computeWakeFactor(x, y) {
  let upstream = 0;
  const maxRange = 6;

  for (let dy = 1; dy <= maxRange; dy++) {
    const ny = y - dy;
    if (!inBounds(x, ny)) break;
    const cell = grid[ny][x];
    if (!cell || !cell.connected) continue;
    if (cell.type === "turbine_3" || cell.type === "turbine_5") {
      upstream++;
    }
  }

  const factor = 1 - 0.1 * upstream;
  return Math.max(0.4, factor); // mínimo 40% de eficiencia
}

function computeCableLossFactor(distToSub) {
  if (distToSub == null) return 1;

  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;

  const lossPerPixel = profile.cableLossPerPixel;
  const maxLoss = profile.maxCableLoss;

  const loss = Math.min(maxLoss, distToSub * lossPerPixel);
  return 1 - loss; // 1 = sin pérdidas, 0 = pérdidas totales
}

// “Producción” demo con lógica conjunta
function updateProduction() {
  // 1) Conectividad y distancias
  computeConnectionsAndDistances();

  // 2) Capacidad de subestación (dependiente de la zona)
  let numSubstations = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") numSubstations++;
    }
  }

  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  const capacityPerSubstation = profile.substationMW; // MW por subestación según zona
  const substationCapacityMW = numSubstations * capacityPerSubstation;


  // 3) Potencia nominal conectada (MW)
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
    capacityFactor = substationCapacityMW / connectedMW; // curtailment
  }

  // 4) Producción
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

      const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
      const windFactor = profile.windFactor;

      const localProd =
        basePerTick * windFactor * wakeFactor * cableFactor * capacityFactor;

      base += localProd;

    }
  }

  // BESS bonus simple
  const bessBonus = player.storageMWh > 0 ? 0.05 : 0;
  const produced = base * (1 + bessBonus);

  player.energyTodayMWh += produced;
  player.co2Tons += produced * 0.0003;
  player.points += Math.round(produced / 2);

  updatePanels();
  drawGrid(); // para repintar turbinas conectadas/desconectadas
}

function updatePanels() {
  document.getElementById("stat-wind").textContent =
    player.windMW.toFixed(0);
  document.getElementById("stat-storage").textContent =
    player.storageMWh.toFixed(0);
  document.getElementById("stat-energy").textContent =
    player.energyTodayMWh.toFixed(0);

  document.getElementById("park-installed").textContent =
    player.windMW.toFixed(0);
  document.getElementById("park-storage").textContent =
    player.storageMWh.toFixed(0);
  document.getElementById("park-energy").textContent =
    player.energyTodayMWh.toFixed(0);
  document.getElementById("park-co2").textContent =
    player.co2Tons.toFixed(2);

  document.getElementById("player-name").textContent = player.name;
  document.getElementById("player-points").textContent =
    player.points.toFixed(0);
}  // Mostrar zona actual en el panel de jugador (si existe el elemento)
  const params = new URLSearchParams(window.location.search);
  const zone = params.get("zone") || "desconocida";
  const bonusEl = document.getElementById("player-bonus");
  if (bonusEl) {
    bonusEl.textContent = "Zona: " + currentZone;
  }














