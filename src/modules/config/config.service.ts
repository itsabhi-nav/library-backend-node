import { toIsoOrNull } from "../../shared/serializers";
import { AppError } from "../../core/errors/AppError";
import { TtlCache } from "../../shared/ttlCache";
import * as repo from "./config.repository";

const PUBLIC_KEYS = new Set([
  "library_name",
  "school_affiliation",
  "developer_credit",
  "login_image_url",
]);

// Config is read on almost every page load but changes rarely. Cache the raw
// rows briefly and invalidate on write so admin edits still reflect immediately.
const configCache = new TtlCache<any[]>(60000);
const CONFIG_CACHE_KEY = "all";

function serializeConfig(row: any) {
  return {
    configKey: row.config_key,
    configValue: row.config_value,
    description: row.description ?? null,
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function getAllConfigs(role?: string | null) {
  const rows = await configCache.getOrSet(CONFIG_CACHE_KEY, () => repo.findAllConfigs());
  const isStaff = role === "ADMIN" || role === "LIBRARIAN";
  const filtered = isStaff ? rows : rows.filter((r) => PUBLIC_KEYS.has(r.config_key));
  return filtered.map(serializeConfig);
}

export async function updateConfig(key: string, value: string) {
  const row = await repo.updateConfig(key, value);
  if (!row) throw AppError.notFound(`Config key not found: ${key}`);
  configCache.delete(CONFIG_CACHE_KEY);
  return serializeConfig(row);
}
