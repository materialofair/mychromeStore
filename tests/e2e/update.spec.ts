import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { createApp, bootstrap } from '../../server/app';
import { generateKeyPairSync } from 'node:crypto';
import { zipSync } from 'fflate';
import { resolve } from 'node:path';

const origin='http://localhost:8794';
const password='isolated-updater-test-2026';
let app: ReturnType<typeof createApp>;
let admin: APIRequestContext;
let developer: APIRequestContext;
let reviewer: APIRequestContext;
let adminToken:string,developerToken:string,reviewerToken:string;
const keys=[0,1].map(()=>generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'der',type:'spki'}).toString('base64'));
const ids:string[]=[];
const submissions:string[][]=[[],[]];
async function account(username:string) {
  const client=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
  const response=await client.post('/api/login',{data:{username,password}});
  expect(response.ok()).toBe(true);
  return {client,token:(await response.json()).csrfToken as string};
}
function archive(index:number,version:string) {
  return Buffer.from(zipSync({
    'manifest.json':Buffer.from(JSON.stringify({manifest_version:3,key:keys[index],name:`Update QA ${index}`,version,permissions:['storage']})),
    'popup.html':Buffer.from('<!doctype html><title>Updater QA</title>'),
    'popup.js':Buffer.from(`globalThis.release = ${JSON.stringify(version)};`),
  }));
}
async function seed(page:Page,id:string) {
  await page.evaluate(async({id})=>{
    const release=await(await fetch(`/api/extensions/${id}/releases/1.0.0.json`)).json();
    const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle(id,{create:true});
    for(const file of release.files){
      const writable=await(await directory.getFileHandle(file.path,{create:true})).createWritable();
      await writable.write(Uint8Array.from(atob(file.content),(char:string)=>char.charCodeAt(0)));await writable.close();
    }
  },{id});
}
async function localVersion(page:Page,id:string){
  return page.evaluate(async id=>{
    const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle(id);
    return JSON.parse(await(await(await dir.getFileHandle('manifest.json')).getFile()).text()).version;
  },id);
}
test.beforeAll(async()=>{
  app=createApp({dbPath:':memory:',origin,staticDir:resolve('dist')});
  await bootstrap(app.db,'update_admin',password);
  await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(8794,'127.0.0.1',done);});
  ({client:admin,token:adminToken}=await account('update_admin'));
  for(const [username,role] of [['update_dev','developer'],['update_reviewer','reviewer']]){
    const response=await admin.post('/api/users',{headers:{'X-CSRF-Token':adminToken},data:{username,password,role}});expect(response.ok()).toBe(true);
  }
  ({client:developer,token:developerToken}=await account('update_dev'));
  ({client:reviewer,token:reviewerToken}=await account('update_reviewer'));
  for(let index=0;index<2;index++)for(const version of ['1.0.0','1.1.0']){
    const uploaded=await developer.post('/api/submissions',{headers:{'X-CSRF-Token':developerToken,'Content-Type':'application/zip'},data:archive(index,version)});
    expect(uploaded.ok()).toBe(true);
    const submission=(await uploaded.json()).submission;ids[index]=submission.extensionId;submissions[index].push(submission.id);
    const approved=await reviewer.post(`/api/submissions/${submission.id}/review`,{headers:{'X-CSRF-Token':reviewerToken},data:{decision:'approved',reason:'QA approval'}});
    expect(approved.ok()).toBe(true);
  }
});
test.afterAll(async()=>{await admin?.dispose();await developer?.dispose();await reviewer?.dispose();await app?.close();});

test('approved updater uses real API and independent OPFS journals; restores after all releases withdrawn',async({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>{
      const id=new URL(location.href).searchParams.get('id')!;
      return(await navigator.storage.getDirectory()).getDirectoryHandle(id);
    }});
  });
  await page.goto(`${origin}/publish.html`);
  await seed(page,ids[0]);await seed(page,ids[1]);
  await page.goto(`${origin}/update.html?id=${ids[0]}`);
  await page.getByTestId('bind').click();
  await expect(page.getByTestId('disk-version')).toHaveText('v1.0.0');
  await page.getByTestId('update').click();
  await expect(page.getByTestId('disk-version')).toHaveText('v1.1.0');
  await page.waitForFunction(()=>document.querySelector('.publish-message')?.textContent?.includes('手动重新加载'),{},{timeout:20000});
  await expect(page.locator('.publish-message')).toContainText('手动重新加载');
  await expect(page.getByTestId('runtime-version')).toHaveText('未检测到');
  expect(await localVersion(page,ids[0])).toBe('1.1.0');
  const download=page.waitForEvent('download');await page.locator('#download-backup').click();
  expect((await download).suggestedFilename()).toContain(`${ids[0]}-backup-1.0.0`);
  await page.goto(`${origin}/update.html?id=${ids[1]}`);
  await expect(page.getByTestId('disk-version')).toHaveText('未检测到');
  await expect(page.getByTestId('restore')).toHaveCount(0);
  await page.getByTestId('bind').click();await expect(page.getByTestId('disk-version')).toHaveText('v1.0.0');
  await page.getByTestId('update').click();await page.waitForFunction(()=>document.querySelector('.publish-message')?.textContent?.includes('手动重新加载'),{},{timeout:20000});
  await expect(page.locator('.publish-message')).toContainText('手动重新加载');
  expect(await localVersion(page,ids[1])).toBe('1.1.0');
  await page.goto(`${origin}/update.html?id=${ids[0]}`);
  await expect(page.getByTestId('disk-version')).toHaveText('v1.1.0');
  await expect(page.getByTestId('restore')).toBeEnabled();
  for(const submission of submissions[0]){
    const response=await admin.post(`/api/submissions/${submission}/unpublish`,{headers:{'X-CSRF-Token':adminToken},data:{reason:'QA withdrawal'}});expect(response.ok()).toBe(true);
  }
  expect((await page.request.get(`${origin}/api/extensions/${ids[0]}/releases/1.0.0.json`)).status()).toBe(404);
  await page.locator('#refresh-update').click();await expect(page.locator('.publish-message')).toContainText('下架');
  await expect(page.getByTestId('update')).toBeDisabled();
  await page.getByTestId('restore').click();await expect(page.locator('.publish-message')).toContainText('已恢复本地文件 v1.0.0',{timeout:15000});
  expect(await localVersion(page,ids[0])).toBe('1.0.0');expect(await localVersion(page,ids[1])).toBe('1.1.0');
  await page.reload();await expect(page.getByTestId('disk-version')).toHaveText('v1.0.0');
  await expect(page.locator('#download-backup')).toBeEnabled();
  await page.goto(`${origin}/update.html?id=${ids[1]}`);await expect(page.getByTestId('restore')).toBeEnabled();
  await page.screenshot({path:'test-results/update-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/update-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});
