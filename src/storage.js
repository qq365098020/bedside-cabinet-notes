import { createInitialState, mergeDefaults, uid } from "./data.js";

const STATE_KEY = "price_action_review_state_v1";
const DB_NAME = "price_action_review_images_v1";
const DB_VERSION = 1;
const IMAGE_STORE = "images";

let stateCache = null;
let dbPromise = null;

export function loadState() {
  if (stateCache) return stateCache;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    stateCache = raw ? mergeDefaults(JSON.parse(raw)) : createInitialState();
  } catch (error) {
    console.warn("Failed to load state, using initial state", error);
    stateCache = createInitialState();
  }
  saveState(stateCache);
  return stateCache;
}

export function saveState(nextState = stateCache) {
  stateCache = mergeDefaults(nextState || createInitialState());
  localStorage.setItem(STATE_KEY, JSON.stringify(stateCache));
  return stateCache;
}

export function updateState(mutator) {
  const current = loadState();
  const result = mutator(current) || current;
  return saveState(result);
}

export function replaceState(nextState) {
  stateCache = mergeDefaults(nextState);
  return saveState(stateCache);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        const store = db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
        store.createIndex("tradeId", "tradeId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function txStore(db, mode = "readonly") {
  return db.transaction(IMAGE_STORE, mode).objectStore(IMAGE_STORE);
}

export async function putImageRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db, "readwrite").put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function getImageRecord(id) {
  if (!id) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllImages() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getImagesForTrade(tradeId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const index = txStore(db).index("tradeId");
    const request = index.getAll(tradeId);
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => (a.sort || 0) - (b.sort || 0)));
    request.onerror = () => reject(request.error);
  });
}

export async function deleteImageRecord(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllImages() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function bulkPutImages(records) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE);
    records.forEach((record) => store.put(record));
    transaction.oncomplete = () => resolve(records);
    transaction.onerror = () => reject(transaction.error);
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function resizeImage(dataUrl, maxSide, quality) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function storeImageFile(file, metadata = {}) {
  const originalDataUrl = await readAsDataUrl(file);
  const type = file.type || "image/jpeg";
  const isImage = type.startsWith("image/");
  const normalized = isImage ? await resizeImage(originalDataUrl, 2200, 0.9) : originalDataUrl;
  const thumbnail = isImage ? await resizeImage(originalDataUrl, 520, 0.78) : originalDataUrl;
  const extension = extensionFromMime(type) || extensionFromName(file.name) || "jpg";
  const now = new Date().toISOString();
  const record = {
    id: uid("image"),
    tradeId: metadata.tradeId || "",
    category: metadata.category || "entry_before",
    fileName: file.name || `image.${extension}`,
    extension,
    type,
    originalDataUrl: normalized,
    thumbnailDataUrl: thumbnail,
    sort: metadata.sort || Date.now(),
    isCover: Boolean(metadata.isCover),
    createdAt: now,
    updatedAt: now
  };
  await putImageRecord(record);
  return record;
}

export async function storeImageDataUrl(dataUrl, metadata = {}) {
  const type = dataUrl.match(/^data:([^;]+);/)?.[1] || "image/jpeg";
  const isImage = type.startsWith("image/");
  const normalized = isImage ? await resizeImage(dataUrl, 2200, 0.9) : dataUrl;
  const thumbnail = isImage ? await resizeImage(dataUrl, 520, 0.78) : dataUrl;
  const extension = extensionFromMime(type) || "jpg";
  const now = new Date().toISOString();
  const record = {
    id: uid("image"),
    tradeId: metadata.tradeId || "",
    category: metadata.category || "review_marked",
    fileName: metadata.fileName || `annotated-${Date.now()}.${extension}`,
    extension,
    type,
    originalDataUrl: normalized,
    thumbnailDataUrl: thumbnail,
    sort: metadata.sort || Date.now(),
    isCover: Boolean(metadata.isCover),
    createdAt: now,
    updatedAt: now
  };
  await putImageRecord(record);
  return record;
}

export function extensionFromMime(type) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  return map[type] || "";
}

function extensionFromName(name = "") {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  if (meta.includes(";base64")) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(data));
}

export function bytesToDataUrl(bytes, type = "image/jpeg") {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
