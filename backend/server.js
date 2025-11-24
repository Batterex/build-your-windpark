// backend/server.js
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

// Necesario para que el backend entienda JSON
app.use(express.json());

// Permitir peticiones desde tu frontend en Vercel
app.use(
  cors({
    origin: "*", // luego podemos restringirlo a tu dominio de Vercel
  })
);

// ----- LÓGICA DEL JUEGO (GRID EN MEMORIA) -----

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

// Simple endpoint para comprobar que está vivo
app.get("/", (req, res) => {
  res.send("Build-Your-Windpark backend is running.");
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

app.listen(PORT, () => {
  console.log("Backend listening on port", PORT);
});

