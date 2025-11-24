// ----------------------------
// World Map – Build Your Windpark
// ----------------------------

// Tamaño del mundo: 1000 × 1000 = 1.000.000 píxeles
const WORLD_SIZE = 1000;

// Cada pixel del mundo se mostrará como un rectángulo en un canvas 800×800
const CANVAS_SIZE = 800;
const PIXEL_SIZE = CANVAS_SIZE / WORLD_SIZE;  // 0.8px → usamos escala visual

let canvas = document.getElementById("world-canvas");
let ctx = canvas.getContext("2d");

let infoBox = document.getElementById("world-info");

// BASE DE DATOS SIMPLIFICADA (por ahora local)
let world = [];

// Crear mundo vacío
for (let y = 0; y < WORLD_SIZE; y++) {
  let row = [];
  for (let x = 0; x < WORLD_SIZE; x++) {
    row.push({
      owner: null,
      logo: null,
      production: 0,
      terrainSeed: (x * 73856093) ^ (y * 19349663)
    });
  }
  world.push(row);
}

// Pintar mundo
function drawWorld() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const cell = world[y][x];

      if (!cell.owner) {
        ctx.fillStyle = "#334155"; // libre
      } else {
        ctx.fillStyle = "#10b981"; // comprado
      }

      ctx.fillRect(
        x * PIXEL_SIZE,
        y * PIXEL_SIZE,
        PIXEL_SIZE,
        PIXEL_SIZE
      );
    }
  }
}

drawWorld();

// Convertir coordenada de clic a pixel del mundo
function getWorldCoords(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) / PIXEL_SIZE);
  const y = Math.floor((evt.clientY - rect.top) / PIXEL_SIZE);
  return { x, y };
}

// Hover info
canvas.addEventListener("mousemove", (evt) => {
  const { x, y } = getWorldCoords(evt);
  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return;

  const cell = world[y][x];

  infoBox.style.left = evt.pageX + 10 + "px";
  infoBox.style.top = evt.pageY + 10 + "px";
  infoBox.innerHTML = `
    <b>Pixel:</b> (${x}, ${y})<br>
    <b>Owner:</b> ${cell.owner || "LIBRE"}<br>
    <b>Production:</b> ${cell.production} MWh<br>
    <b>Seed:</b> ${cell.terrainSeed}
  `;
  infoBox.classList.remove("hidden");
});

canvas.addEventListener("mouseleave", () => {
  infoBox.classList.add("hidden");
});

// CLICK EN UN PIXEL DEL MUNDO → redirigir a su tablero 40×40
canvas.addEventListener("click", (evt) => {
  const { x, y } = getWorldCoords(evt);
  const cell = world[y][x];

  if (!cell.owner) {
    alert(`Pixel (${x}, ${y}) está libre.\n\nPrecio: 0,09 €.\n\nCuando activemos Stripe podrás comprarlo.`);
    return;
  }

  // Si tiene dueño, abrimos el tablero 40×40
  window.location.href = `/index.html?tileX=${x}&tileY=${y}`;
});
