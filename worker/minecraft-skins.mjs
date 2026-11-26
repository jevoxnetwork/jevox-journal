import {json} from './security.mjs';

export const bundledMemberSkins = {
  cvasolir: {
    path: '/assets/skins/lqgend-official.png',
    textureHash: '6d2ccff44f91accb0f815895f0cde7348d2a22f1007f23dd262de366e9873612',
    slim: true,
  },
  destq: {
    path: '/assets/minecraft-textures/4e5f43872d3a82d1e3bfb875b2da556af8d15240663419f07bef1f14d4a8d97c.png',
    textureHash: '4e5f43872d3a82d1e3bfb875b2da556af8d15240663419f07bef1f14d4a8d97c',
    slim: false,
  },
};

async function minecraftJson(fetcher, url) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(2500),
    redirect: 'error',
    cf: {cacheEverything:true,cacheTtlByStatus:{'200-299':3600,'400-403':0,'404':300,'405-499':0,'500-599':0}},
  });
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error('Minecraft profile unavailable');
  return response.json();
}

export async function minecraftSkin(memberName, fetcher = fetch) {
  const bundled = Object.hasOwn(bundledMemberSkins, memberName) ? bundledMemberSkins[memberName] : null;
  const fallback = {skin: bundled?.path ?? null, slim: bundled?.slim ?? false};
  const nickname = memberName === 'cvasolir' ? 'lqgend' : memberName;
  try {
    const lookup = await minecraftJson(fetcher, 'https://api.minecraftservices.com/minecraft/profile/lookup/name/' + nickname)
      .catch(() => minecraftJson(fetcher, 'https://api.mojang.com/users/profiles/minecraft/' + nickname));
    if (!lookup || !/^[a-f0-9]{32}$/.test(lookup.id)) return json(fallback);
    const profile = await minecraftJson(fetcher, 'https://sessionserver.mojang.com/session/minecraft/profile/' + lookup.id);
    const property = profile?.properties?.find(item => item.name === 'textures');
    const skin = property ? JSON.parse(atob(property.value)).textures?.SKIN : null;
    const hash = skin?.url?.match(/^https?:\/\/textures\.minecraft\.net\/texture\/([a-f0-9]{32,64})$/)?.[1];
    if (!hash) return json(fallback);
    return json({
      skin: hash === bundled?.textureHash ? bundled.path : 'https://textures.minecraft.net/texture/' + hash,
      slim: skin.metadata?.model === 'slim',
    });
  } catch {
    return json(fallback);
  }
}

export async function minecraftTexture(hash){
  if(!/^[a-f0-9]{32,64}$/.test(hash))return new Response(null,{status:404});
  try{
    const source=await fetch('https://textures.minecraft.net/texture/'+hash,{
      signal:AbortSignal.timeout(6000),redirect:'error',cf:{cacheEverything:true,cacheTtl:86400},
    });
    if(!source.ok||!source.headers.get('content-type')?.startsWith('image/png'))return new Response(null,{status:502});
    return new Response(source.body,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400, immutable'}});
  }catch{
    return new Response(null,{status:503});
  }
}
