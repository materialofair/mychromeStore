import { generateKeyPairSync, createHash } from 'node:crypto';
// Only the public key is printed. This key stabilizes an unpacked extension ID;
// it is not a CRX signing key and cannot prove ownership to the store.
const der = generateKeyPairSync('rsa', {modulusLength:2048}).publicKey.export({type:'spki',format:'der'});
const extensionId = [...createHash('sha256').update(der).digest().subarray(0,16)].map(byte=>String.fromCharCode(97+(byte>>4),97+(byte&15))).join('');
console.log(JSON.stringify({key:der.toString('base64'),extensionId},null,2));
