<button class="build-btn" data-asset="bulldozer">
  <img src="assets/icons/bulldozer.svg" alt="" />
  Bulldozer – borrar celda
</button>

// WORLD MAP REAL CON ZONAS PREDEFINIDAS
// -------------------------------------
// Grid lógico de 1000x1000 (1M píxeles), pero usamos un canvas 1000x500
// para adaptarlo a la proyección del mapamundi (relación 2:1).

const WORLD_SIZE = 1000;               // ancho lógico del mundo
const canvas = document.getElementById("world-canvas");
const ctx = canvas.getContext("2d");
const infoBox = document.getElementById("world-info");

// Imagen del mapamundi (estática)
const mapImage = new Image();
mapImage.src = "assets/worldmap.png";

// Matriz del mundo (por ahora sólo seed y producción)
// Más adelante aquí guardaremos owner, logo, etc.
let world = [];
let purchasedTiles = {}; // { "x,y": { owner: "..." } }


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

// Cuando se cargue la imagen, la pintamos centrada
mapImage.onload = async function () {
  ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);

  // Cargar píxeles comprados desde el backend
  await loadPurchasedTiles();
  drawPurchasedOverlay();
};
async function loadPurchasedTiles() {
  try {
    const res = await fetch("https://build-your-windpark-backend.onrender.com/api/world/purchased");
    purchasedTiles = await res.json();

    // actualizar owners en la matriz world
    for (const key in purchasedTiles) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      if (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE) {
        world[y][x].owner = purchasedTiles[key].owner;
      }
    }
  } catch (err) {
    console.error("Error cargando tiles comprados:", err);
  }
}

function drawPurchasedOverlay() {
  const tileWidth = canvas.width / WORLD_SIZE;
  const tileHeight = canvas.height / (WORLD_SIZE / 2); // porque usamos 1000x500

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#22c55e"; // verde para píxel comprado

  for (const key in purchasedTiles) {
    const [xStr, yStr] = key.split(",");
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    const px = x * tileWidth;
    const py = y * tileHeight;

    ctx.fillRect(px, py, tileWidth, tileHeight);
  }

  ctx.restore();
}


// Convertir clic en coordenadas del grid 1000x1000
function getWorldCoords(evt) {
  const rect = canvas.getBoundingClientRect();

  const scaleX = WORLD_SIZE / rect.width;
  const scaleY = (WORLD_SIZE / 2) / rect.height; // canvas 1000x500, pero grid 1000x1000

  const x = Math.floor((evt.clientX - rect.left) * scaleX);
  const y = Math.floor((evt.clientY - rect.top) * scaleY); // 0..500 aprox (latitudes)

  return { x, y };
}

// Clasificar una coordenada (x,y) en una ZONA simple por bandas de latitud
function getZoneFromCoords(x, y) {
  // y va de ~0 (norte) a ~500 (sur). Normalizamos a 0..1
  const latNorm = y / 500; // 0 = polo norte, 1 = polo sur

  if (latNorm < 0.15) return "polar_norte";
  if (latNorm < 0.40) return "templado_norte";
  if (latNorm < 0.65) return "tropical";
  if (latNorm < 0.90) return "templado_sur";
  return "polar_sur";
}

// Hover: mostrar info básica del pixel
canvas.addEventListener("mousemove", (evt) => {
  const { x, y } = getWorldCoords(evt);

  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return;

  const cell = world[y][x];
  const zone = getZoneFromCoords(x, y);

  infoBox.style.left = evt.pageX + 15 + "px";
  infoBox.style.top = evt.pageY + 15 + "px";

  infoBox.innerHTML = `
    <b>Pixel:</b> (${x}, ${y})<br>
    <b>Zona:</b> ${zone}<br>
    <b>Owner:</b> ${cell.owner || "LIBRE"}<br>
    <b>Prod:</b> ${cell.production} MWh<br>
    <b>Seed:</b> ${cell.seed}
  `;

  infoBox.classList.remove("hidden");
});

// CLICK → compra del pixel con Stripe (modo test) y luego tablero
canvas.addEventListener("click", async (evt) => {
  const { x, y } = getWorldCoords(evt);
  const zone = getZoneFromCoords(x, y);

  // ==========================
  // MODO DESARROLLO (sin pagos)
  // ==========================
  if (!PAYMENTS_ENABLED) {
    console.log("Stripe DESACTIVADO → modo desarrollo.");
    window.location.href = `/index.html?tileX=${x}&tileY=${y}&zone=${zone}`;
    return;
  }

  // ==========================
  // MODO PRODUCCIÓN (Stripe ON)
  // ==========================
  const ok = confirm(
    `Pixel (${x}, ${y}) en zona ${zone}.\n\nPrecio: 0,50 €.\n\n¿Quieres ir a pagar con Stripe?`
  );
  if (!ok) return;

  try {
    const res = await fetch("https://build-your-windpark-backend.onrender.com/api/world/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tileX: x, tileY: y, zone })
    });

    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("No se pudo crear la sesión de pago.");
    }
  } catch (err) {
    console.error("Error al llamar al backend:", err);
    alert("Error al conectar con el servidor de pagos.");
  }
});


