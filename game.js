// Config básica
const GRID_SIZE = 40;
const CELL_SIZE = 20;

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

function handleCanvasClick(e) {
  if (!selectedAsset) return;
  const { x, y } = getCellFromEvent(e);
  if (!inBounds(x, y)) return;

  const cell = grid[y][x];

  // MODO BULLDOZER: borrar lo que haya en la celda
  if (selectedAsset === "bulldozer") {
    if (cell.type !== "empty") {
      // restar estadísticas según lo que quitamos
      removeAssetStats(cell.type);

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

  drawGrid();
  updatePanels();

  // Guardar también en backend
  updateCellOnServer(x, y, cell.type, cell.owner);
}


function drawGrid() {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#1f2937";
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      drawAsset(grid[y][x].type, x, y);
    }
  }
}

// Dibuja iconos
function drawAsset(type, x, y) {
  const cx = x * CELL_SIZE + CELL_SIZE / 2;
  const cy = y * CELL_SIZE + CELL_SIZE / 2;
  const cell = grid[y][x];

  if (!type || type === "empty") return;

  if (type.startsWith("turbine")) {
    // Blanca si conectada, naranja si no
    ctx.strokeStyle = cell && cell.connected ? "#e5e7eb" : "#f97316";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type.startsWith("bess")) {
    ctx.strokeStyle = "#38bdf8";
    ctx.strokeRect(cx - 6, cy - 6, 12, 12);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();
  } else if (type === "substation") {
    ctx.strokeStyle = "#fbbf24";
    ctx.strokeRect(cx - 7, cy - 7, 14, 14);
  } else if (type === "cable") {
    ctx.strokeStyle = "#6b7280";
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.stroke();
  } else if (type === "metmast") {
    ctx.strokeStyle = "#a855f7";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
  } else if (type === "solar") {
    ctx.strokeStyle = "#22c55e";
    ctx.strokeRect(cx - 7, cy - 4, 14, 8);
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
  const loss = Math.min(0.3, distToSub * 0.005); // 0.5% por pixel, máx 30%
  return 1 - loss;
}

// “Producción” demo con lógica conjunta
function updateProduction() {
  // 1) Conectividad y distancias
  computeConnectionsAndDistances();

  // 2) Capacidad de subestación
  let numSubstations = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x].type === "substation") numSubstations++;
    }
  }
  const substationCapacityMW = numSubstations * 50; // 50 MW por subestación

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

      const localProd =
        basePerTick * wakeFactor * cableFactor * capacityFactor;

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
}

