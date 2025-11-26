// backend/server.js
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: "*", // más adelante lo limitamos a Vercel
  })
);

// ---------------------------------------
// LÓGICA DEL JUEGO 40x40 (GRID EN MEMORIA)
// ---------------------------------------

const GRID_SIZE = 40;

let grid = Array.from({ length: GRID_SIZE }, () =>
  Array.from({ length: GRID_SIZE }, () => ({
    type: "empty",
    owner: null,
  }))
);

// GET /api/grid -> devuelve el estado completo del grid
app.get("/api/grid", (req, res) => {
  res.json(grid);
});

// POST /api/grid/cell -> actualiza una celda concreta
app.post("/api/grid/cell", (req, res) => {
  const { x, y, type, owner } = req.body;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    x < 0 ||
    x >= GRID_SIZE ||
    y < 0 ||
    y >= GRID_SIZE
  ) {
    return res.status(400).json({ error: "Bad coordinates" });
  }

  grid[y][x] = {
    type: type || "empty",
    owner: owner || null,
  };

  res.json({ ok: true, cell: grid[y][x] });
});

// Reset completo del grid
app.post("/api/reset", (req, res) => {
  grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      type: "empty",
      owner: null,
    }))
  );
  res.json({ ok: true });
});

// ---------------------------------------
// WORLD MAP – Gestión de píxeles comprados
// ---------------------------------------

// En memoria por ahora (en el futuro usaremos BBDD)
let purchasedTiles = {}; // { "x,y": { owner: "LUIGI" } }

// Crear sesión de pago Stripe para comprar un pixel
app.post("/api/world/create-checkout-session", async (req, res) => {
  try {
    const { tileX, tileY, zone } = req.body;

    if (tileX == null || tileY == null) {
      return res
        .status(400)
        .json({ error: "Faltan coordenadas tileX/tileY" });
    }

    const zoneSafe = zone || "desconocida";

    // Precio 0,50 €
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Pixel Energético (${tileX}, ${tileY}) – zona ${zoneSafe}`,
            },
            unit_amount: 50, // céntimos = 0,50 €
          },
          quantity: 1,
        },
      ],
      success_url: `https://build-your-windpark.vercel.app/world/success.html?tileX=${tileX}&tileY=${tileY}&zone=${zoneSafe}`,
      cancel_url: `https://build-your-windpark.vercel.app/world/index.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creando sesión Stripe:", err);
    res.status(500).json({ error: "Stripe error" });
  }
});

// Marcar pixel como comprado (DEV MODE)
app.post("/api/world/mark-owned", (req, res) => {
  const { tileX, tileY, ownerName } = req.body;

  if (tileX == null || tileY == null) {
    return res.status(400).json({ error: "Faltan coordenadas" });
  }

  const key = `${tileX},${tileY}`;
  purchasedTiles[key] = {
    owner: ownerName || "DESCONOCIDO",
  };

  console.log("🟢 Pixel comprado:", key, purchasedTiles[key]);
  res.json({ ok: true });
});

// Devolver los píxeles comprados
app.get("/api/world/purchased", (req, res) => {
  res.json(purchasedTiles);
});

// ---------------------------------------
// Endpoint simple para health check
// ---------------------------------------
app.get("/", (req, res) => {
  res.send("Build-Your-Windpark backend is running.");
});

// Arrancamos el servidor
app.listen(PORT, () => {
  console.log("Backend listening on port", PORT);
});
