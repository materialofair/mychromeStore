import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedStorage, journal, loadDirectory, saveDirectory, exclusive } from '../src/storage';
import type { Backup, Directory } from '../src/core';

// Minimal transactional IDB surface; requests commit asynchronously as the browser API does.
const records = new Map<string,unknown>();
const locks: string[] = [];
beforeEach(()=> {
  records.clear();locks.length=0;
  vi.stubGlobal('indexedDB', {open:()=> {
    const request: Record<string,unknown> = {};
    queueMicrotask(()=> {
      request.result = {close:()=>{},transaction:()=> {
        const transaction: Record<string,unknown> = {};
        transaction.objectStore = ()=>({
          get:(key:string)=> {const result={result:records.get(key)};queueMicrotask(()=> (transaction.oncomplete as ()=>void)());return result;},
          put:(value:unknown,key:string)=> {const result={result:key};queueMicrotask(()=> {records.set(key,value);(transaction.oncomplete as ()=>void)();});return result;},
        });
        return transaction;
      }};
      (request.onsuccess as ()=>void)();
    });
    return request;
  }});
  vi.stubGlobal('navigator',{locks:{request:async(name:string,_options:unknown,operation:(lock:object)=>unknown)=>{locks.push(name);return operation({name});}}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('extension-scoped persistence',()=> {
  it('keeps directories, backups and locks independent from other IDs and existing Demo keys',async()=> {
    const a=scopedStorage('a'.repeat(32)),b=scopedStorage('b'.repeat(32));
    const dirA={name:'a'} as Directory,dirB={name:'b'} as Directory,dirDemo={name:'demo'} as Directory;
    await a.saveDirectory(dirA);await b.saveDirectory(dirB);await saveDirectory(dirDemo);
    await a.journal.put({from:'1.0.0'} as Backup);await b.journal.put({from:'2.0.0'} as Backup);await journal.put({from:'0.1.0'} as Backup);
    expect(await a.loadDirectory()).toEqual(dirA);expect(await b.loadDirectory()).toEqual(dirB);expect(await loadDirectory()).toEqual(dirDemo);
    expect((await a.journal.get())?.from).toBe('1.0.0');expect((await b.journal.get())?.from).toBe('2.0.0');expect((await journal.get())?.from).toBe('0.1.0');
    await a.exclusive(async()=>{});await b.exclusive(async()=>{});await exclusive(async()=>{});
    expect(new Set(locks).size).toBe(3);expect(locks[2]).toBe('space-store-update');
    expect(records.has('directory')).toBe(true);expect(records.has('backup')).toBe(true);
  });
  it('rejects malformed scopes before accessing browser storage',()=> {
    expect(()=>scopedStorage('../backup')).toThrow('ID 无效');
    expect(()=>scopedStorage('z'.repeat(32))).toThrow('ID 无效');
  });
  it('refuses parallel mutation if the same-extension lock is held',async()=> {
    const operation=vi.fn();
    vi.stubGlobal('navigator',{locks:{request:async(_name:string,_options:unknown,callback:(lock:null)=>unknown)=>callback(null)}});
    await expect(scopedStorage('a'.repeat(32)).exclusive(operation)).rejects.toThrow('另一个商店标签页');
    expect(operation).not.toHaveBeenCalled();
  });
});
