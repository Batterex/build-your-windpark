// -------------------------------------------------------------
// API.JS – funciones para comunicar el frontend con el backend
// -------------------------------------------------------------

// Cuando tengas backend en Render, cambiarás esta URL por la tuya:
const API_BASE = "https://build-your-windpark-backend.onrender.com/api";

// -------------------------------------------
// Obtener el grid desde el backend (más tarde)
// -------------------------------------------
async function fetchGridFromServer() {
  try {
    const res = await fetch(`${API_BASE}/grid`);
    if (!res.ok) throw new Error("Error al obtener el grid del servidor");
    return await res.json();
  } catch (err) {
    console.warn("Backend no conectado. Usando grid local.");
    return null; // frontend usará el grid local por defecto
  }
}

// -------------------------------------------
// Guardar una celda del grid en el backend
// -------------------------------------------
async function updateCellOnServer(x, y, type, owner) {
  try {
    const res = await fetch(`${API_BASE}/grid/cell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, type, owner })
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.warn("No se pudo guardar en backend. Todo sigue local.");
  }
}

// -------------------------------------------
// Comprar (stub – cuando activemos Stripe)
// -------------------------------------------
async function purchasePoints(priceId) {
  try {
    const res = await fetch(`${API_BASE}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId })
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Error en el proceso de compra:", err);
  }
}

// -------------------------------------------
// Autenticación básica (dummy por ahora)
// -------------------------------------------
async function loginUser(email, password) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Error en login:", err);
  }
}

