# D1/R2 存储架构

当前 Sites 工具可用于私有部署，但本环境没有可调用的 D1/R2 创建、绑定、迁移或密钥配置工具，也没有 Cloudflare D1/R2 凭据。因此不能把现有本地版本伪装成已接入 D1/R2。

## 目标架构

- D1 保存结构化数据：交易、结果、复盘、策略、标签、账户、品种预设、APP 设置、图片元数据。
- R2 保存文件：原始截图、缩略图、复盘标注图。
- 浏览器本地只保存草稿、待同步队列、少量最近交易、缩略图缓存和 UI 偏好。
- 所有记录必须带 `owner_id`，后端按当前登录身份过滤。
- 原图不使用永久公开链接；图片访问走受保护后端接口或短期授权地址。

## D1 表结构草案

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  account TEXT,
  timeframe TEXT,
  strategy TEXT,
  strategy_version TEXT,
  plan_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  review_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  category TEXT NOT NULL,
  object_key TEXT NOT NULL,
  thumbnail_key TEXT,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (trade_id) REFERENCES trades(id)
);

CREATE TABLE app_settings (
  owner_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 后端接口草案

- `GET /api/session`：返回当前登录用户与权限。
- `GET /api/trades`：只返回当前 owner 的交易。
- `PUT /api/trades/:id`：幂等写入，使用 `id` 和 `updated_at` 处理重复提交。
- `DELETE /api/trades/:id`：进入回收站，不立即删除图片。
- `POST /api/images/upload-url`：创建受保护上传任务。
- `POST /api/images/:id/complete`：校验 R2 对象大小、MIME、宽高和 checksum 后写入 D1。
- `GET /api/images/:id/original`：身份校验后返回原图或短期授权地址。
- `GET /api/images/:id/thumbnail`：身份校验后返回缩略图。
- `POST /api/backup/export`：生成完整 ZIP。
- `POST /api/backup/import`：检查完整性后合并导入。

## 迁移策略

1. 检测旧 `localStorage` 和 IndexedDB。
2. 显示交易数量、图片数量和总大小。
3. 用户确认后按交易和图片分批上传。
4. 每个上传任务用永久唯一 ID 断点续传。
5. 上传成功后验证 D1 记录、R2 对象和 checksum。
6. 迁移成功后保留旧数据，用户手动备份确认后再清理。
