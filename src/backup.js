import { APP_VERSION, DATA_VERSION } from "./data.js";
import {
  bulkPutImages,
  bytesToDataUrl,
  dataUrlToBytes,
  getAllImages,
  loadState,
  replaceState
} from "./storage.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: dosDate };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function concat(chunks, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

export function createZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const now = dosDateTime();

  files.forEach((file) => {
    const nameBytes = textEncoder.encode(file.path);
    const data = file.data instanceof Uint8Array ? file.data : textEncoder.encode(String(file.data));
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, now.time);
    writeUint16(localView, 12, now.date);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    local.set(nameBytes, 30);
    localChunks.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, now.time);
    writeUint16(centralView, 14, now.date);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.length + data.length;
  });

  const centralLength = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralLength);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return concat([...localChunks, ...centralChunks, end], offset + centralLength + end.length);
}

function findEndOfCentralDirectory(bytes) {
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error("没有找到 ZIP 中央目录");
}

export async function readZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const eocd = findEndOfCentralDirectory(bytes);
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = {};

  for (let i = 0; i < total; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
    const method = view.getUint16(offset + 10, true);
    if (method !== 0) throw new Error("当前仅支持本 APP 导出的无压缩 ZIP 备份");
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries[name] = bytes.slice(dataStart, dataStart + compressedSize);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function jsonBytes(value) {
  return textEncoder.encode(JSON.stringify(value, null, 2));
}

function parseJsonEntry(entries, path) {
  if (!entries[path]) throw new Error(`备份缺少 ${path}`);
  return JSON.parse(textDecoder.decode(entries[path]));
}

function checksumString(value) {
  const bytes = textEncoder.encode(JSON.stringify(value));
  return crc32(bytes).toString(16).padStart(8, "0");
}

export async function buildBackupZip() {
  const state = loadState();
  const images = await getAllImages();
  const imageIndex = [];
  const files = [];
  const tradeDates = state.trades.map((trade) => trade.tradeDate || trade.createdAt?.slice(0, 10)).filter(Boolean).sort();
  const manifest = {
    appVersion: APP_VERSION,
    dataVersion: DATA_VERSION,
    backupCreatedAt: new Date().toISOString(),
    tradeCount: state.trades.length,
    imageCount: images.length,
    dateRange: {
      start: tradeDates[0] || "",
      end: tradeDates[tradeDates.length - 1] || ""
    },
    checksum: checksumString({
      trades: state.trades,
      strategies: state.strategies,
      settings: state.settings,
      imageIds: images.map((image) => image.id).sort()
    })
  };

  files.push({ path: "manifest.json", data: jsonBytes(manifest) });
  files.push({ path: "trades.json", data: jsonBytes(state.trades) });
  files.push({ path: "strategies.json", data: jsonBytes(state.strategies) });
  files.push({ path: "settings.json", data: jsonBytes(state.settings) });
  files.push({ path: "drafts.json", data: jsonBytes(state.drafts) });
  files.push({ path: "trash.json", data: jsonBytes(state.trash || []) });

  images.forEach((image) => {
    const originalPath = `images/original/${image.id}.${image.extension || "jpg"}`;
    const thumbnailPath = `images/thumbnail/${image.id}.jpg`;
    imageIndex.push({
      id: image.id,
      tradeId: image.tradeId,
      category: image.category,
      fileName: image.fileName,
      extension: image.extension || "jpg",
      type: image.type || "image/jpeg",
      sort: image.sort || 0,
      isCover: Boolean(image.isCover),
      originalPath,
      thumbnailPath,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt
    });
    files.push({ path: originalPath, data: dataUrlToBytes(image.originalDataUrl) });
    files.push({ path: thumbnailPath, data: dataUrlToBytes(image.thumbnailDataUrl || image.originalDataUrl) });
  });
  files.push({ path: "images/index.json", data: jsonBytes(imageIndex) });

  return {
    blob: new Blob([createZip(files)], { type: "application/zip" }),
    manifest
  };
}

export async function inspectBackupFile(file) {
  const entries = await readZip(file);
  const manifest = parseJsonEntry(entries, "manifest.json");
  const trades = parseJsonEntry(entries, "trades.json");
  const imageIndex = parseJsonEntry(entries, "images/index.json");
  const current = loadState();
  const currentIds = new Set(current.trades.map((trade) => trade.id));
  const duplicateTrades = trades.filter((trade) => currentIds.has(trade.id)).length;
  const missingImages = imageIndex.filter((image) => !entries[image.originalPath]).length;
  const dates = trades.map((trade) => trade.tradeDate || trade.createdAt?.slice(0, 10)).filter(Boolean).sort();
  return {
    entries,
    manifest,
    trades,
    strategies: parseJsonEntry(entries, "strategies.json"),
    settings: parseJsonEntry(entries, "settings.json"),
    drafts: entries["drafts.json"] ? JSON.parse(textDecoder.decode(entries["drafts.json"])) : {},
    trash: entries["trash.json"] ? JSON.parse(textDecoder.decode(entries["trash.json"])) : [],
    imageIndex,
    report: {
      compatible: Number(manifest.dataVersion) <= DATA_VERSION,
      tradeCount: trades.length,
      imageCount: imageIndex.length,
      duplicateTrades,
      missingImages,
      dateRange: {
        start: dates[0] || "",
        end: dates[dates.length - 1] || ""
      }
    }
  };
}

export async function mergeImportBackup(inspection) {
  if (!inspection.report.compatible) throw new Error("备份数据版本高于当前 APP，无法导入");
  if (inspection.report.missingImages > 0) throw new Error("备份图片不完整，已阻止导入");

  const current = loadState();
  const existingTradeIds = new Set(current.trades.map((trade) => trade.id));
  const mergedTrades = [
    ...current.trades,
    ...inspection.trades.filter((trade) => !existingTradeIds.has(trade.id))
  ];
  const strategiesById = new Map(current.strategies.map((strategy) => [strategy.id, strategy]));
  inspection.strategies.forEach((strategy) => strategiesById.set(strategy.id, strategy));
  const imageRecords = inspection.imageIndex.map((image) => {
    const originalBytes = inspection.entries[image.originalPath];
    const thumbnailBytes = inspection.entries[image.thumbnailPath] || originalBytes;
    return {
      id: image.id,
      tradeId: image.tradeId,
      category: image.category,
      fileName: image.fileName,
      extension: image.extension,
      type: image.type || "image/jpeg",
      originalDataUrl: bytesToDataUrl(originalBytes, image.type || "image/jpeg"),
      thumbnailDataUrl: bytesToDataUrl(thumbnailBytes, "image/jpeg"),
      sort: image.sort || 0,
      isCover: Boolean(image.isCover),
      createdAt: image.createdAt,
      updatedAt: image.updatedAt
    };
  });

  replaceState({
    ...current,
    trades: mergedTrades,
    strategies: Array.from(strategiesById.values()),
    settings: {
      ...current.settings,
      ...inspection.settings,
      savedFilters: [
        ...(current.settings.savedFilters || []),
        ...(inspection.settings.savedFilters || []).filter(
          (incoming) => !(current.settings.savedFilters || []).some((item) => item.name === incoming.name)
        )
      ],
      templates: [
        ...(current.settings.templates || []),
        ...(inspection.settings.templates || []).filter(
          (incoming) => !(current.settings.templates || []).some((item) => item.id === incoming.id)
        )
      ]
    },
    drafts: current.drafts,
    trash: [...(current.trash || []), ...(inspection.trash || [])]
  });
  await bulkPutImages(imageRecords);
  return {
    importedTrades: inspection.trades.length - inspection.report.duplicateTrades,
    importedImages: imageRecords.length
  };
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
