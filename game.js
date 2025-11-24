// Config básica
const GRID_SIZE = 40;
const CELL_SIZE = 20;

let canvas, ctx;
let grid = [];
let selectedAsset = null;

// Estado básico de jugador (luego se ligará al backend)
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

  initGrid();
  initUI();
  drawGrid();

  // tick producción cada 5 segundos (versión demo)
  setInterval(updateProduction, 5000);
});

function initGrid() {
  grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      type: "empty",
      owner: null,
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

  // Click en canvas
  canvas.addEventListener("click", handleCanvasClick);

  // Hover info (básico)
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
  if (cell.type !== "empty") return;

  const cost = getAssetCost(selectedAsset);
  if (player.points < cost) {
    alert("Not enough points!");
    return;
  }

  player.points -= cost;

  cell.type = selectedAsset;
  cell.owner = player.id;

  applyAssetStats(selectedAsset);

  drawGrid();
  updatePanels();

  // 🔄 Guardar en backend
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

// Iconos “simples” dibujados con canvas (puedes cambiarlos luego por imágenes)
function drawAsset(type, x, y) {
  const cx = x * CELL_SIZE + CELL_SIZE / 2;
  const cy = y * CELL_SIZE + CELL_SIZE / 2;

  if (!type || type === "empty") return;

  if (type.startsWith("turbine")) {
    ctx.strokeStyle = "#e5e7eb";
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

// “Producción” demo
function updateProduction() {
  let base = 0;

  grid.forEach((row) => {
    row.forEach((cell) => {
      if (cell.owner === player.id) {
        if (cell.type === "turbine_3") base += 2;
        if (cell.type === "turbine_5") base += 4;
      }
    });
  });

  // BESS bonus simple
  const bessBonus = player.storageMWh > 0 ? 0.05 : 0;
  const produced = base * (1 + bessBonus);
  player.energyTodayMWh += produced;
  player.co2Tons += produced * 0.0003; // inventado

  // dar puntos por energía
  player.points += Math.round(produced / 2);
  updatePanels();
}

function updatePanels() {
  // Top bar
  document.getElementById("stat-wind").textContent =
    player.windMW.toFixed(0);
  document.getElementById("stat-storage").textContent =
    player.storageMWh.toFixed(0);
  document.getElementById("stat-energy").textContent =
    player.energyTodayMWh.toFixed(0);

  // Park stats
  document.getElementById("park-installed").textContent =
    player.windMW.toFixed(0);
  document.getElementById("park-storage").textContent =
    player.storageMWh.toFixed(0);
  document.getElementById("park-energy").textContent =
    player.energyTodayMWh.toFixed(0);
  document.getElementById("park-co2").textContent =
    player.co2Tons.toFixed(2);

  // Player
  document.getElementById("player-name").textContent = player.name;
  document.getElementById("player-points").textContent =
    player.points.toFixed(0);
}


