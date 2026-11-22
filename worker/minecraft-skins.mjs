import {json} from './security.mjs';

export async function minecraftSkin(nickname){
  const options={signal:AbortSignal.timeout(5000),redirect:'error',cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':3600,'404':300,'500-599':0}}};
  try{
    const lookup=await fetch('https://api.mojang.com/users/profiles/minecraft/'+nickname,options);
    if(lookup.status===404||lookup.status===204)return json({skin:null},404);
    if(!lookup.ok)throw Error();
    const {id}=await lookup.json();
    if(!/^[a-f0-9]{32}$/.test(id))throw Error();
    const profile=await fetch('https://sessionserver.mojang.com/session/minecraft/profile/'+id,options);
    if(!profile.ok)throw Error();
    const {properties}=await profile.json();
    const property=properties.find(item=>item.name==='textures');
    const skin=property?JSON.parse(atob(property.value)).textures?.SKIN:null;
    const hash=skin?.url?.match(/^https?:\/\/textures\.minecraft\.net\/texture\/([a-f0-9]{32,64})$/)?.[1];
    if(!hash)return json({skin:null},404);
    return json({skin:'https://textures.minecraft.net/texture/'+hash,slim:skin.metadata?.model==='slim'});
  }catch{
    return json({skin:null},503);
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
