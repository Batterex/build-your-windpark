// WORLD MAP REAL
// ----------------------------
// Tamaño del mapa: se ajusta automáticamente a la imagen real
// El grid lógico es de 1000 × 1000 píxeles (1 millón)

const WORLD_SIZE = 1000;            // grid lógico
const IMG_WIDTH = 2000;             // tamaño real de la imagen del mapa
const IMG_HEIGHT = 1000;            // (se ajustará al ratio real)

// canvas
const canvas = document.getElementById("world-canvas");
const ctx = canvas.getContext("2d");

// tooltip
const infoBox = document.getElementById("world-info");

// Cargar imagen real del mapa mundi
const mapImage = new Image();
mapImage.src = "assets/worldmap.png";

mapImage.onload = function () {
  // Pintar imagen en el canvas
  ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);
};

// MATRIZ DEL MUNDO
let world = [];

for (let y = 0; y < WORLD_SIZE; y++) {
  let row = [];
  for (let x = 0; x < WORLD_SIZE; x++) {
    row.push({
      owner: null,
      production: 0,
      seed: (x * 73856093) ^ (y * 19349663)
    });
  }
  world.push(row);
}

// Convertir clic a coordenadas reales del grid 1000×1000
function getWorldCoords(evt) {
  const rect = canvas.getBoundingClientRect();

  const scaleX = WORLD_SIZE / rect.width;
  const scaleY = (WORLD_SIZE / 2) / rect.height; // imagen es 2:1

  const x = Math.floor((evt.clientX - rect.left) * scaleX);
  const y = Math.floor((evt.clientY - rect.top) * scaleY);

  return { x, y };
}

// Hover
canvas.addEventListener("mousemove", (evt) => {
  const { x, y } = getWorldCoords(evt);

  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return;

  const cell = world[y][x];

  infoBox.style.left = evt.pageX + 15 + "px";
  infoBox.style.top = evt.pageY + 15 + "px";

  infoBox.innerHTML = `
    <b>Pixel: </b>${x}, ${y}<br>
    <b>Owner:</b> ${cell.owner || "LIBRE"}<br>
    <b>Prod:</b> ${cell.production} MWh<br>
    <b>Seed:</b> ${cell.seed}
  `;

  infoBox.classList.remove("hidden");
});

canvas.addEventListener("mouseleave", () => {
  infoBox.classList.add("hidden");
});

// CLICK → abrir tablero 40×40
canvas.addEventListener("click", (evt) => {
  const { x, y } = getWorldCoords(evt);
  const cell = world[y][x];

  if (!cell.owner) {
    alert(`Pixel (${x}, ${y}) está LIBRE.\nPrecio: 0,09 €.\nMás adelante activaremos el sistema Stripe.`);
    return;
  }

  // ir al tablero del pixel
  window.location.href = `/index.html?tileX=${x}&tileY=${y}`;
});
