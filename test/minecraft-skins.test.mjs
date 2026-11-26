import test from 'node:test';
import assert from 'node:assert/strict';
import { bundledMemberSkins, minecraftSkin } from '../worker/minecraft-skins.mjs';

const uuid = 'a'.repeat(32);
const imageUrl = hash => 'https://textures.minecraft.net/texture/' + hash;

function profile(hash, metadata) {
  const value = btoa(JSON.stringify({textures:{SKIN:{url:imageUrl(hash),metadata}}}));
  return Response.json({properties:[{name:'textures',value}]});
}

test('Cvasolir resolves the Lqgend profile and serves the matching bundled texture', async () => {
  const urls = [];
  const { textureHash, path } = bundledMemberSkins.cvasolir;
  const response = await minecraftSkin('cvasolir', async url => {
    urls.push(url);
    return urls.length === 1 ? Response.json({id:uuid}) : profile(textureHash, {model:'slim'});
  });
  assert.deepEqual(urls, [
    'https://api.minecraftservices.com/minecraft/profile/lookup/name/lqgend',
    'https://sessionserver.mojang.com/session/minecraft/profile/' + uuid,
  ]);
  assert.deepEqual(await response.json(), {skin:path,slim:true});
});

test('Temporary name lookup failure falls back to Mojang and still accepts an updated official skin', async () => {
  const urls = [];
  const hash = 'b'.repeat(64);
  const response = await minecraftSkin('destq', async url => {
    urls.push(url);
    if (urls.length === 1) return new Response(null, {status:429});
    if (urls.length === 2) return Response.json({id:uuid});
    return profile(hash);
  });
  assert.equal(urls[1], 'https://api.mojang.com/users/profiles/minecraft/destq');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {skin:imageUrl(hash),slim:false});
});

test('An unavailable Minecraft profile returns an available bundled skin or the default', async () => {
  for (const name of ['destq','cvasolir','another_player']) {
    const response = await minecraftSkin(name, async url => {
      if (url.includes('sessionserver')) throw new TypeError('Fetch failed');
      return Response.json({id:uuid});
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      skin: bundledMemberSkins[name]?.path ?? null,
      slim: bundledMemberSkins[name]?.slim ?? false,
    });
  }
});
