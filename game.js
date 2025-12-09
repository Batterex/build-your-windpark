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
let energyPhase = 0; // para animar energía en cables
let simHour = 6; // hora simulada
let gridTerrain;
let hasActiveBESSAtNight = false; // indica si algún BESS está aportando energía de noche

// =========================
// SISTEMA DE NIVELES
// =========================
function getLevelInfo(totalRE) {
  // totalRE en MWh
  if (totalRE < 1000) {
    return {
      level: 1,
      label: "Junior Engineer",
      bonusDesc: "Sin bonus. Aprende a diseñar tu primera central.",
    };
  }
  if (totalRE < 5000) {
    return {
      level: 2,
      label: "Plant Engineer",
      bonusDesc: "+5% eficiencia eólica (se aplicará en futuras versiones).",
    };
  }
  if (totalRE < 15000) {
    return {
      level: 3,
      label: "Senior Engineer",
      bonusDesc: "-5% pérdidas en cableado (futuro ajuste).",
    };
  }
  if (totalRE < 50000) {
    return {
      level: 4,
      label: "Grid Specialist",
      bonusDesc: "+10% capacidad en subestaciones.",
    };
  }
  return {
    level: 5,
    label: "System Architect",
    bonusDesc: "Máxima eficiencia y acceso a todas las funciones.",
  };
}

// =========================
// ESTADO DEL MUNDO
// =========================
let worldTerrainSeed = 0; // reservado para el futuro
let gridTerrain; // mapa de orografía (valles/llanos/montes)

// Estado jugador
let player = {
  id: "local-player",
  name: (window.localStorage && window.localStorage.getItem("byrp_player_name")) || "Luigi",
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

    // después de tener grid listo
    initTerrain(tileX, tileY);
    initUI();
    drawGrid();

    // producción cada 5 s
    setInterval(updateProduction, 5000);

    // animación de cables (~8 fps)
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
// OROGRAFÍA SENCILLA
// =========================
function initTerrain() {
  gridTerrain = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    const row = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const r = Math.random();
      let t;
      if (r < 0.25) t = "valley";       // 25% valles
      else if (r < 0.5) t = "flat";     // 25% llanos
      else if (r < 0.75) t = "hill";    // 25% colinas
      else t = "mountain";              // 25% montañas
      row.push({ type: t });
    }
    gridTerrain.push(row);
  }
}

// Ruido pseudo-aleatorio simple por celda (determinista)
function pseudoRandom2D(x, y, seed) {
  let n = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  n = (n ^ (n >> 13)) * 1274126177;
  n = (n ^ (n >> 16)) >>> 0;
  return (n % 1000) / 1000; // 0..1
}

function terrainToMultiplier(tType) {
  switch (tType) {
    case "valley":
      return 0.9; // un poco menos viento
    case "flat":
      return 1.0;
    case "hill":
      return 1.05;
    case "mountain":
      return 1.1;
    default:
      return 1.0;
  }
}

// =========================
// UI
// =========================
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
      initTerrain(0, 0); // de momento reiniciamos con seed por defecto

      player.points = 200;
      player.windMW = 0;
      player.storageMWh = 0;
      player.energyTodayMWh = 0;
      player.windEnergyMWh = 0;
      player.solarEnergyMWh = 0;
      player.bessEnergyMWh = 0;
      player.co2Tons = 0;
      simHour = 6;

      updatePanels();
      drawGrid();
    });
  }

  // botón cambio de nombre
  const changeNameBtn = document.getElementById("btn-change-name");
  if (changeNameBtn) {
    changeNameBtn.addEventListener("click", () => {
      const newName = prompt("Escribe tu nombre de jugador:", player.name || "Jugador");
      if (!newName) return;
      player.name = newName;
      if (window.localStorage) {
        window.localStorage.setItem("byrp-player_name", newName);
      }
      updatePanels();
    });
  }

  // placeholders Leaderboard / Login
  const leaderBtn = document.getElementById("btn-leaderboard");
  if (leaderBtn) {
    leaderBtn.addEventListener("click", () => {
      alert(
        "Leaderboard aún no está disponible.\n\nEn futuras versiones verás aquí el ranking de las mejores centrales del mundo (top 3 oro/plata/bronce)."
      );
    });
  }

  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      alert(
        "Login / Signup todavía no está activo.\n\nMás adelante podrás crear tu cuenta, guardar tus centrales y competir contra otros jugadores."
      );
    });
  }

  // listeners del canvas
  const hoverInfo = document.getElementById("hover-info");
  canvas.addEventListener("click", handleCanvasClick);

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
// CLICK / CONSTRUCCIÓN
// =========================
function handleCanvasClick(e) {
  if (!selectedAsset) return;

  const { x, y } = getCellFromEvent(e);
  if (!inBounds(x, y)) return;

  const cell = grid[y][x];

  // ==========================
  // MODO BULLDOZER
  // ==========================
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
      cell.overloaded = false;

      drawGrid();
      updatePanels();

      updateCellOnServer(x, y, "empty", null);
    }
    return;
  }

  // ==========================
  // MODO CONSTRUCCIÓN NORMAL
  // ==========================

  // Si ya está ocupado, no hacemos nada
  if (cell.type !== "empty") return;

  // Comprobación de terreno (no permitir generadores en montaña/agua, si lo estás usando)
  const terrType =
    gridTerrain && gridTerrain[y] && gridTerrain[y][x]
      ? gridTerrain[y][x].type
      : "flat";

  if (
    (selectedAsset === "turbine_3" ||
      selectedAsset === "turbine_5" ||
      selectedAsset === "solar") &&
    (terrType === "mountain" || terrType === "water")
  ) {
    alert(
      "No puedes instalar este generador en este tipo de terreno.\n" +
        "Prueba en una celda más llana o adecuada."
    );
    return;
  }

  const cost = getAssetCost(selectedAsset);
  if (player.points < cost) {
    alert("No tienes puntos suficientes.");
    return;
  }

  // Pagar
  player.points -= cost;

  // Colocar
  cell.type = selectedAsset;
  cell.owner = player.id;
  cell.connected = false;
  cell.distToSub = null;
  cell.energized = false;
  cell.overloaded = false;

  applyAssetStats(selectedAsset);

  // Aviso si es generador y no tiene conexión mínima a cable/subestación
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

  // AVISO DE SUBESTACIÓN SATURADA
  if (
    selectedAsset === "turbine_3" ||
    selectedAsset === "turbine_5" ||
    selectedAsset === "solar"
  ) {
    const totalMW = getTotalConnectedGenerationMW();
    const capacityMW = getSubstationCapacityMW();
    if (capacityMW > 0 && totalMW > capacityMW) {
      alert(
        "ATENCIÓN: La(s) subestación(es) han alcanzado su capacidad máxima.\n\n" +
          "Parte de la generación se está limitando (curtailment).\n" +
          "Considera añadir otra subestación o rediseñar el cableado."
      );
    }
  }

  drawGrid();
  updatePanels();

  // Guardar en backend
  updateCellOnServer(x, y, cell.type, cell.owner);
}

// =========================
// HELPERS GEOM / VECINOS
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

// =========================
// CAPACIDAD Y MW CONECTADOS
// =========================

// MW de generación conectada (turbinas + solar)
function getTotalConnectedGenerationMW() {
  let total = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.connected) continue;

      if (cell.type === "turbine_3") total += 3;
      else if (cell.type === "turbine_5") total += 5;
      else if (cell.type === "solar") total += 0.5; // 0,5 MW por celda solar
    }
  }
  return total;
}

// Capacidad total de las subestaciones en MW (nº SUB × profile.substationMW)
function getSubstationCapacityMW() {
  let numSubs = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell && cell.type === "substation") {
        numSubs++;
      }
    }
  }
  if (numSubs === 0) return 0;
  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  return numSubs * profile.substationMW;
}

function getCableConnections(x, y) {
  const dirs = { up: false, down: false, left: false, right: false };
  const candidates = ["cable", "substation", "turbine_3", "turbine_5", "solar"];

  // ¿Hay alguna subestación actualmente sobrecargada?
function isAnySubstationOverloaded() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell && cell.type === "substation" && cell.overloaded) {
        return true;
      }
    }
  }
  return false;
}

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
// DIBUJO
// =========================
function drawGrid() {
  // Fondo general
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // SIN líneas de grid: solo orografía + assets
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Fondo de orografía (valley/flat/hill/mountain)
      drawTerrain(x, y);

      // Elemento de la celda (turbina, cable, solar, etc.)
      drawAsset(grid[y][x].type, x, y);
    }
  }
}

function drawTerrain(x, y) {
  if (!gridTerrain || !gridTerrain[y] || !gridTerrain[y][x]) return;

  const t = gridTerrain[y][x].type;
  const baseX = x * CELL_SIZE;
  const baseY = y * CELL_SIZE;

  // Colores más fuertes para ver bien las zonas
  switch (t) {
    case "valley":
      ctx.fillStyle = "rgba(16, 185, 129, 0.35)";   // verde valle
      break;
    case "flat":
      ctx.fillStyle = "rgba(37, 99, 235, 0.30)";    // azul llano
      break;
    case "hill":
      ctx.fillStyle = "rgba(34, 197, 94, 0.40)";    // verde colinas
      break;
    case "mountain":
      ctx.fillStyle = "rgba(148, 163, 184, 0.55)";  // gris montaña
      break;
    default:
      return;
  }

  ctx.fillRect(baseX, baseY, CELL_SIZE, CELL_SIZE);
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
  const totalMW = getTotalConnectedGenerationMW();
  const capacityMW = getSubstationCapacityMW();
  const overloaded = capacityMW > 0 && totalMW > capacityMW;

  ctx.fillStyle = "#0f172a";
  ctx.strokeStyle = overloaded ? "#f97373" : "#fbbf24"; // rojo si saturada
  ctx.lineWidth = 1.6;
  ctx.fillRect(cx - 7, cy - 5, 14, 10);
  ctx.strokeRect(cx - 7, cy - 5, 14, 10);

  // ventanitas
  ctx.fillStyle = overloaded ? "#fecaca" : "#fbbf24";
  ctx.globalAlpha = 0.45;
  ctx.fillRect(cx - 5, cy - 3, 4, 6);
  ctx.fillRect(cx + 1, cy - 3, 4, 6);
  ctx.globalAlpha = 1;

  // rayo
  ctx.fillStyle = overloaded ? "#fecaca" : "#fbbf24";
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

  // base del cable (gris por defecto)
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1.6;
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

  // nodo central
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 1.3, 0, Math.PI * 2);
  ctx.stroke();

  // ==========================
  // Efecto energía en el cable
  // ==========================

  // Obtenemos si es de día o noche leyendo simHour (variable global)
  const isDayNow = simHour >= 6 && simHour < 19;

  // Si no hay energía, nada más
  if (!cell || !cell.energized) {
    return;
  }

  // De noche: cable "apagado" → rojo oscuro, sin animación
  if (!isDayNow) {
    ctx.save();
    ctx.strokeStyle = "#7f1d1d"; // rojo oscuro
    ctx.lineWidth = 2;
    ctx.setLineDash([]); // sin guiones

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
    return;
  }

  // De día: líquido verde como hasta ahora
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

    ctx.strokeStyle = isConnected ? "#bbf5a0" : "#fed7aa";
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

  const candidates = ["cable", "turbine_3", "turbine_5", "solar"];

  // seeds = subestaciones
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") {
        dist[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }

  // BFS
  while (queue.length > 0) {
    const { x, y } = queue.shift();
    const d = dist[y][x];

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ncell = grid[ny][nx];
      if (!ncell || !candidates.includes(ncell.type)) continue;
      const nd = d + 1;
      if (nd < dist[ny][nx]) {
        dist[ny][nx] = nd;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  // aplicar distancias
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      const d = dist[y][x];

      if (cell.type === "cable") {
        cell.energized = d < Infinity;
      }

      if (cell.type === "turbine_3" || cell.type === "turbine_5" || cell.type === "solar") {
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
  // Primero calculamos qué está conectado y distancias
  computeConnectionsAndDistances();

  // Avanzamos la hora (1 hora por tick)
  simHour = (simHour + 1) % 24;
  const isDay = simHour >= 6 && simHour < 19; // solar solo de 06:00 a 19:00

  // Contar subestaciones
  let numSubstations = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell && cell.type === "substation") {
        numSubstations++;
        // por defecto no sobrecargada, ya la marcaremos más abajo
        cell.overloaded = false;
      }
    }
  }

  const profile = ZONE_PROFILES[currentZone] || ZONE_PROFILES.desconocida;
  const capacityPerSub = profile.substationMW; // MW máximo por subestación
  const totalCapacityMW = numSubstations * capacityPerSub;

  // MW conectados (turbinas + solar)
  let connectedWindMW = 0;
  let connectedSolarMW = 0;

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.connected) continue;

      if (cell.type === "turbine_3") connectedWindMW += 3;
      if (cell.type === "turbine_5") connectedWindMW += 5;
      if (cell.type === "solar") connectedSolarMW += 0.5; // 0.5 MW por celda
    }
  }

  const totalConnectedMW = connectedWindMW + connectedSolarMW;

  // Factor de curtailment por capacidad de subestaciones
  let capacityFactor = 1;
  if (totalCapacityMW > 0 && totalConnectedMW > totalCapacityMW) {
    capacityFactor = totalCapacityMW / totalConnectedMW;
  }

  // Marcar las subestaciones sobrecargadas (para pintar en rojo)
  const overloaded = totalCapacityMW > 0 && totalConnectedMW > totalCapacityMW;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell && cell.type === "substation") {
        cell.overloaded = overloaded;
      }
    }
  }

  // Ahora calculamos la producción real
  let windProd = 0;
  let solarProd = 0;
  let bessProd = 0; // pendiente

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.connected || cell.owner !== player.id) continue;

      const cableFactor = computeCableLossFactor(cell.distToSub);

      // EÓLICO
      if (cell.type === "turbine_3" || cell.type === "turbine_5") {
        let base = 0;
        if (cell.type === "turbine_3") base = 2;
        if (cell.type === "turbine_5") base = 4;

        const windFactor = profile.windFactor;
        const terrType = gridTerrain && gridTerrain[y] && gridTerrain[y][x]
          ? gridTerrain[y][x].type
          : "flat";
        const terrFactor = terrainToMultiplier(terrType);

        // Por ahora sin wake para simplificar
        const localWind =
          base * windFactor * terrFactor * cableFactor * capacityFactor;

        windProd += localWind;
      }

      // SOLAR (solo de día)
      if (cell.type === "solar" && isDay) {
        const baseSolar = 0.5; // MW por celda
        const solarFactorZone = 1.0;  // luego afinable
        const solarFactorTerr = 1.0;  // luego afinable

        const localSolar =
          baseSolar * solarFactorZone * solarFactorTerr * cableFactor * capacityFactor;

        solarProd += localSolar;
      }

      // BESS como generador → lo dejamos para la próxima iteración
    }
  }

  // Acumular energía
  player.windEnergyMWh += windProd;
  player.solarEnergyMWh += solarProd;
  player.bessEnergyMWh += bessProd;

  const totalProd = windProd + solarProd + bessProd;

  player.energyTodayMWh += totalProd;
  player.co2Tons += totalProd * 0.0003;
  player.points += Math.round(totalProd / 2);

  updatePanels();
  drawGrid();
}

// =========================
// PANEL STATS + NIVELES
// =========================
function updatePanels() {
  const totalRE =
    player.windEnergyMWh + player.solarEnergyMWh + player.bessEnergyMWh;
  const levelInfo = getLevelInfo(totalRE);

  // ------- Barra superior -------
  const headerWind = document.getElementById("header-wind");
  const headerSolar = document.getElementById("header-solar");
  const headerBess = document.getElementById("header-bess");
  const headerTotal = document.getElementById("header-total");
  const headerTime = document.getElementById("header-time");

  if (headerWind) headerWind.textContent = player.windEnergyMWh.toFixed(1);
  if (headerSolar) headerSolar.textContent = player.solarEnergyMWh.toFixed(1);
  if (headerBess) headerBess.textContent = player.bessEnergyMWh.toFixed(1);
  if (headerTotal) headerTotal.textContent = totalRE.toFixed(1);
  if (headerTime) {
    const h = simHour.toString().padStart(2, "0");
    headerTime.textContent = `${h}:00`;
  }

  // ===== Park stats (panel intermedio) =====
  const installedSpan = document.getElementById("park-installed");
  const storageSpan = document.getElementById("park-storage");
  const energySpan = document.getElementById("park-energy");
  const co2Span = document.getElementById("park-co2");

  if (installedSpan) installedSpan.textContent = player.windMW.toFixed(0);
  if (storageSpan) storageSpan.textContent = player.storageMWh.toFixed(0);
  if (energySpan) energySpan.textContent = player.energyTodayMWh.toFixed(1);
  if (co2Span) co2Span.textContent = player.co2Tons.toFixed(2);

  // ===== Player status =====
  const nameSpan = document.getElementById("player-name");
  const ptsSpan = document.getElementById("player-points");
  const levelSpan = document.getElementById("player-level");
  const bonusEl = document.getElementById("player-bonus");

  if (nameSpan) nameSpan.textContent = player.name;
  if (ptsSpan) ptsSpan.textContent = player.points.toFixed(0);
  if (levelSpan) levelSpan.textContent = `${levelInfo.level} – ${levelInfo.label}`;

  if (bonusEl) {
    let zoneText = currentZone;
    if (currentZone === "templado_norte" || currentZone === "templado_sur") {
      zoneText = "Temperate (templado)";
    } else if (currentZone === "tropical") {
      zoneText = "Tropical";
    } else if (currentZone === "polar_norte" || currentZone === "polar_sur") {
      zoneText = "Polar";
    }

    let zoneBonus = "";
    if (currentZone === "tropical") {
      zoneBonus = "Buen solar, viento medio.";
    } else if (currentZone === "polar_norte" || currentZone === "polar_sur") {
      zoneBonus = "Viento fuerte, sol bajo.";
    } else {
      zoneBonus = "Condiciones equilibradas.";
    }

    bonusEl.textContent =
      `Zona: ${zoneText} – ${zoneBonus} | Level bonus: ${levelInfo.bonusDesc}`;
  }
}




















