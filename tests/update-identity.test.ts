import { describe, expect, it } from 'vitest';
import { extensionIdForKey, inspectIdentity, validateBackupIdentity, validateCatalog } from '../src/update-identity';
import type { Backup, Catalog, Directory } from '../src/core';

const key = btoa('stable extension public key');
const otherKey = btoa('another extension public key');
const encode = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const manifest = (version: string, publicKey = key) => encode({manifest_version:3,key:publicKey,name:'Team Notes',version});
function directory(files: Record<string,Uint8Array>): Directory {
  return {
    name:'team-notes', queryPermission:async()=> 'granted', requestPermission:async()=> 'granted',
    getDirectoryHandle: async()=> {throw new Error('unexpected nested file');}, removeEntry:async()=> {throw new Error('unexpected mutation');},
    getFileHandle: async path => {
      if (!(path in files)) throw Object.assign(new Error('missing'),{name:'NotFoundError'});
      return {getFile:async()=>({arrayBuffer:async()=>new Uint8Array(files[path]).buffer}),createWritable:async()=>{throw new Error('unexpected mutation');}};
    },
  };
}
async function catalog(): Promise<Catalog> {
  return {extensionId:await extensionIdForKey(key),key,name:'Team Notes',latestVersion:'1.1.0',versions:['1.0.0','1.1.0'],storeOrigin:'http://localhost:5173'};
}
function backup(files: Record<string,Uint8Array>): Backup {
  return {directory:directory(files),status:'pending',from:'1.0.0',to:'1.1.0',createdAt:'2026-09-25',before:{'manifest.json':manifest('1.0.0'),'popup.js':encode('old')},after:{'manifest.json':manifest('1.1.0'),'popup.js':encode('new')}};
}
describe('published updater identity boundary',()=> {
  it('accepts the selected ID and exact origin, rejecting another ID or origin',async()=> {
    const c = await catalog();
    expect(await validateCatalog(c,c.extensionId,c.storeOrigin)).toEqual(c);
    await expect(validateCatalog(c,'a'.repeat(32),c.storeOrigin)).rejects.toThrow();
    await expect(validateCatalog(c,c.extensionId,'https://another.example')).rejects.toThrow();
    await expect(validateCatalog({...c,key:otherKey},c.extensionId,c.storeOrigin)).rejects.toThrow();
  });
  it('rejects identity changes across catalog refreshes',async()=> {
    const c = await catalog();
    await expect(validateCatalog({...c,name:'Renamed'},c.extensionId,c.storeOrigin,c)).rejects.toThrow('身份发生变化');
  });
  it('can inspect a locally installed version that is no longer approved',async()=> {
    const c=await catalog();c.versions=['1.1.0'];
    await expect(inspectIdentity(directory({'manifest.json':manifest('1.0.0')}),c.extensionId,c)).resolves.toBe('1.0.0');
  });
  it('allows identity-matching partial-write backup recovery without consulting released versions',async()=> {
    const b=backup({'manifest.json':manifest('1.0.0'),'popup.js':encode('new')});
    await expect(validateBackupIdentity(b,await extensionIdForKey(key))).resolves.toBeUndefined();
  });
  it('refuses cross-extension backups and replaced original directories',async()=> {
    const b=backup({'manifest.json':manifest('1.0.0',otherKey),'popup.js':encode('new')});
    await expect(validateBackupIdentity(b,await extensionIdForKey(key))).rejects.toThrow('其他扩展');
    await expect(validateBackupIdentity(b,await extensionIdForKey(otherKey))).rejects.toThrow('其他扩展');
  });
  it('refuses overwritten current files even when transaction status is pending',async()=> {
    const b=backup({'manifest.json':manifest('1.0.0'),'popup.js':encode('user edit')});
    await expect(validateBackupIdentity(b,await extensionIdForKey(key))).rejects.toThrow('已改变');
  });
  it('refuses inconsistent backup versions and malformed current manifests',async()=> {
    const b=backup({'manifest.json':manifest('1.0.0'),'popup.js':encode('old')});b.from='0.9.0';
    await expect(validateBackupIdentity(b,await extensionIdForKey(key))).rejects.toThrow('身份不一致');
    const broken=backup({'manifest.json':encode('{'),'popup.js':encode('old')});
    await expect(validateBackupIdentity(broken,await extensionIdForKey(key))).rejects.toThrow('清单损坏');
  });
});
