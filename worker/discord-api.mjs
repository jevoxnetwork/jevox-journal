export const discordGuild = '1543584416889176134';
export const discordLog = '1572356030611067040';
export const discordRoles = {
  'Владелец': '1548515026971664564',
  'Администратор': '1548515083053830277',
  'Младший Администратор': '1548515256828039168',
  'Менеджер': '1548515783834075196',
  'Спектатор': '1548515850628104284',
  'Саппорт': '1548515731962855536',
  'Шериф': '1548515623708139542',
  'Джуниор': '1548515664791076894',
};
export const discordIdValid = value => typeof value === 'string' && /^[1-9][0-9]{16,19}$/.test(value) && BigInt(value)<=18446744073709551615n;

export async function discordRequest(token,path,method='GET',body) {
  const multipart=body instanceof FormData;
  try{return await fetch('https://discord.com/api/v10'+path,{
    method,headers:{'User-Agent':'DiscordBot (https://jevoxjournal.pages.dev, 1.1.0)',
      ...(token?{Authorization:'Bot '+token}:{}),...(body&&!multipart?{'Content-Type':'application/json'}:{})},
    body:multipart?body:body&&JSON.stringify(body),signal:AbortSignal.timeout(7000),redirect:'manual',
  });}catch(error){
    const detail=String(error?.message||error?.name||'Unknown error').replace(/https?:\/\/\S+/g,'[URL]').replace(/\d{16,20}/g,'[ID]').slice(0,160);
    throw Error('Discord HTTP '+method+': '+detail);
  }
}

