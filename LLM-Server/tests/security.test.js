import test from 'node:test';import assert from 'node:assert/strict';import { encryptJson,decryptJson,sha256Hex } from '../src/security.js';
const key=Buffer.alloc(32,7).toString('base64');
test('AES-GCM round trip',async()=>{const src={api_key:'secret',headers:{x:'y'}};const enc=await encryptJson(key,src);assert.match(enc,/^v1\./);assert.deepEqual(await decryptJson(key,enc),src)});
test('sha256 stable',async()=>{assert.equal(await sha256Hex('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')});
