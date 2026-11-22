import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { validateTelegramToken, exchangeIdentity } from '../worker/providers.mjs';
import { authFailureCode } from '../worker/security.mjs';
const config={origin:'https://journal.example',telegram:{id:'123',secret:'test-secret'},vk:{id:'456',secret:''}};
test('Telegram cryptographically verifies signature, issuer, audience, expiry and nonce',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test';const keys=createLocalJWKSet({keys:[jwk]});
 const token=async(overrides={})=>new SignJWT({id:42,name:'Alice',nonce:'expected',...overrides}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://oauth.telegram.org').setAudience('123').setSubject('opaque-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const valid=await token();assert.equal((await validateTelegramToken(valid,config,'expected',keys)).providerId,'42');
 await assert.rejects(validateTelegramToken(valid,config,'wrong',keys));
 await assert.rejects(validateTelegramToken(valid,{...config,telegram:{id:'999'}},'expected',keys));
 const expired=await new SignJWT({id:42,nonce:'expected'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://oauth.telegram.org').setAudience('123').setSubject('42').setIssuedAt().setExpirationTime(1).sign(privateKey);await assert.rejects(validateTelegramToken(expired,config,'expected',keys));
 const {publicKey:other}=await generateKeyPair('RS256');const another=await exportJWK(other);another.kid='test';await assert.rejects(validateTelegramToken(valid,config,'expected',createLocalJWKSet({keys:[another]})));
 const wrongIssuer=await new SignJWT({id:42,nonce:'expected'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://evil.example').setAudience('123').setSubject('42').setIssuedAt().setExpirationTime('5m').sign(privateKey);await assert.rejects(validateTelegramToken(wrongIssuer,config,'expected',keys));
});
test('VK checks token state and retrieves identity server-side, rejecting mismatched user IDs',async()=>{
 const calls=[];const mock=async(url,options)=>{calls.push([url,new URLSearchParams(options.body)]);return Response.json(url.endsWith('/auth')?{access_token:'access-token',user_id:77,state:'expected'}:{user:{user_id:'77',first_name:'Alice',last_name:'Test'}})};
 const identity=await exchangeIdentity(config,'vk',{verifier:'server-verifier'}, {code:'authorization-code',state:'expected',deviceId:'device'},{fetchFn:mock});assert.equal(identity.subject,'77');assert.equal(calls[0][1].get('code_verifier'),'server-verifier');assert.equal(calls[0][1].get('device_id'),'device');assert.equal(calls[1][1].get('access_token'),'access-token');
 await assert.rejects(exchangeIdentity(config,'vk',{verifier:'x'},{code:'x',state:'wrong',deviceId:'d'},{fetchFn:mock}));
 const mismatch=async(url)=>Response.json(url.endsWith('/auth')?{access_token:'a',user_id:77,state:'expected'}:{user:{user_id:'88'}});await assert.rejects(exchangeIdentity(config,'vk',{verifier:'x'},{code:'x',state:'expected',deviceId:'d'},{fetchFn:mismatch}));
});
test('Telegram code flow accepts a properly signed token without widget nonce',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='code-flow';const keys=createLocalJWKSet({keys:[jwk]});
 const token=await new SignJWT({name:'Alice'}).setProtectedHeader({alg:'RS256',kid:'code-flow'}).setIssuer('https://oauth.telegram.org').setAudience('123').setSubject('42').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const mock=async(url,options)=>{assert.equal(url,'https://oauth.telegram.org/token');assert.equal(options.headers.Authorization,'Basic '+btoa('123:test-secret'));assert.equal(new URLSearchParams(options.body).get('code_verifier'),'server-held-verifier');return Response.json({id_token:token,access_token:'unused'})};
 const user=await exchangeIdentity(config,'telegram',{verifier:'server-held-verifier',nonce:'not-in-token'},{code:'single-use-code'},{fetchFn:mock,telegramKeys:keys});assert.equal(user.subject,'42');
 await assert.rejects(validateTelegramToken(token,config,'expected-nonce',keys));
});
test('Failure diagnostics classify provider errors without retaining tokens or raw descriptions',async()=>{
 const mock=async()=>Response.json({error:'invalid_client',error_description:'private-value-should-not-be-logged'},{status:401});
 try{await exchangeIdentity(config,'telegram',{verifier:'x'},{code:'private-code'},{fetchFn:mock});assert.fail('Expected error')}catch(error){assert.equal(authFailureCode(error),'TELEGRAM_TOKEN_INVALID_CLIENT');assert.ok(!error.message.includes('private-value'))}
 assert.equal(authFailureCode({message:'private-secret',code:'untrusted'}),'SERVER_OR_NETWORK_ERROR');
});
test('Provider token requests reject redirects without forwarding credentials',async()=>{
 let calls=0;const mock=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://example.invalid/steal'}})};
 await assert.rejects(exchangeIdentity(config,'telegram',{verifier:'x'},{code:'x'},{fetchFn:mock}));assert.equal(calls,1);
});
