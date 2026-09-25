import { decoder, hash, read, validPath, type Backup, type Catalog, type Directory } from './core';

export async function extensionIdForKey(key: unknown): Promise<string> {
  if (typeof key !== 'string' || !key.length || key.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(key))
    throw new Error('扩展公钥无效');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0)); }
  catch { throw new Error('扩展公钥编码无效'); }
  return (await hash(bytes)).slice(0,32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + Number.parseInt(c,16)));
}

export async function validateCatalog(input: unknown, id: string, origin: string, previous?: Catalog | null): Promise<Catalog> {
  const catalog = input as Catalog;
  if (!catalog || catalog.extensionId !== id || !/^[a-p]{32}$/.test(id) ||
      catalog.storeOrigin !== origin || typeof catalog.name !== 'string' || !catalog.name.trim() ||
      !Array.isArray(catalog.versions) || !catalog.versions.length || catalog.versions.length > 10000 ||
      !catalog.versions.every(version => typeof version === 'string' && /^\d+(?:\.\d+){2,3}$/.test(version)) ||
      !catalog.versions.includes(catalog.latestVersion) || await extensionIdForKey(catalog.key) !== id)
    throw new Error('商店目录的扩展身份、来源或版本无效');
  if (previous && (previous.key !== catalog.key || previous.name !== catalog.name || previous.storeOrigin !== catalog.storeOrigin))
    throw new Error('扩展身份发生变化，已停止更新');
  return catalog;
}

async function manifestIdentity(bytes: Uint8Array | null | undefined, id: string) {
  if (!bytes || bytes.length > 2 * 1024 * 1024) throw new Error('扩展清单缺失或无效，未修改目录');
  let manifest;
  try { manifest = JSON.parse(decoder.decode(bytes)); }
  catch { throw new Error('扩展清单损坏，请下载备份并手动检查目录'); }
  if (manifest?.manifest_version !== 3 || typeof manifest.name !== 'string' ||
      typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){2,3}$/.test(manifest.version) ||
      await extensionIdForKey(manifest.key) !== id)
    throw new Error('所选目录或备份属于其他扩展，未修改文件');
  return manifest as { key: string; name: string; version: string };
}

export async function inspectIdentity(directory: Directory, id: string, catalog?: Catalog | null): Promise<string> {
  const manifest = await manifestIdentity(await read(directory,'manifest.json'),id);
  if (catalog && (manifest.key !== catalog.key || manifest.name !== catalog.name))
    throw new Error('目录身份与商店扩展不一致，未修改文件');
  return manifest.version;
}

// Recovery trusts local identity and the saved transaction, not the current public release list.
export async function validateBackupIdentity(backup: Backup, id: string): Promise<void> {
  const before = await manifestIdentity(backup.before['manifest.json'],id);
  const after = await manifestIdentity(backup.after['manifest.json'],id);
  if (before.key !== after.key || before.name !== after.name || before.version !== backup.from || after.version !== backup.to)
    throw new Error('备份身份不一致，已停止恢复');
  const current = await manifestIdentity(await read(backup.directory,'manifest.json'),id);
  if (current.key !== before.key || current.name !== before.name || ![backup.from,backup.to].includes(current.version))
    throw new Error('备份对应的目录已被替换，已停止恢复');
  for (const path of new Set([...Object.keys(backup.before),...Object.keys(backup.after)])) {
    validPath(path);
    if (!(path in backup.before) || !(path in backup.after)) throw new Error('备份文件列表不完整');
    const actual = await read(backup.directory,path);
    const equals = async (expected: Uint8Array | null) => actual === null || expected === null ? actual === expected : await hash(actual) === await hash(expected);
    if (!(await equals(backup.before[path])) && !(await equals(backup.after[path])))
      throw new Error(`文件 ${path} 已改变；请下载备份并手动恢复，以免覆盖其他文件`);
  }
}
