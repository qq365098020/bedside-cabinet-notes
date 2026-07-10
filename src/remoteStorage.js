export class RemoteStorageUnavailableError extends Error {
  constructor() {
    super("远程 D1/R2 存储尚未配置，当前保留本地可运行版本。");
    this.name = "RemoteStorageUnavailableError";
  }
}

export function isRemoteStorageConfigured() {
  return Boolean(window.__PRICE_ACTION_REMOTE_STORAGE__);
}

export async function requireRemoteStorage() {
  if (!isRemoteStorageConfigured()) {
    throw new RemoteStorageUnavailableError();
  }
  return window.__PRICE_ACTION_REMOTE_STORAGE__;
}
