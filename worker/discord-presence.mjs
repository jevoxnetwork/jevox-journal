import {DurableObject} from 'cloudflare:workers';
import ownerPirs from '../dist/assets/skins/discord-1pirs.png';
import ownerCvasolir from '../dist/assets/skins/discord-cvasolir.png';
import {drainDiscordJobs,syncDiscordJoin} from './discord.mjs';
import {refreshDiscordRoster} from './discord-roster.mjs';
import rosterBanner from '../dist/assets/skins/discord-roster-banner.png';
import {publishTicketPanel,setupTicketCommands,drainTickets} from './discord-tickets.mjs';

import ticketPanelArt from '../dist/assets/skins/discord-ticket-support-v3.jpg';
import ticketSupportArt from '../dist/assets/skins/discord-ticket-support.jpg';
import ticketComplaintArt from '../dist/assets/skins/discord-ticket-complaint.jpg';
import ticketOtherArt from '../dist/assets/skins/discord-ticket-other.jpg';
const ticketImages=new Map([
  ['/skins/discord-ticket-support-v3.jpg',ticketPanelArt],['/skins/discord-ticket-support.jpg',ticketSupportArt],
  ['/skins/discord-ticket-complaint.jpg',ticketComplaintArt],['/skins/discord-ticket-other.jpg',ticketOtherArt],
]);

async function prepareTickets(env){
  await setupTicketCommands(env);
  if(await publishTicketPanel(env))await drainTickets(env);
}

const gateway='https://gateway.discord.gg/?v=10&encoding=json';
const minute=60_000;
const guildMembersIntent=1<<1;
const terminalCodes=new Set([4004,4010,4011,4012,4013,4014]);

export class DiscordPresence extends DurableObject {
  socket=null;
  connecting=null;
  heartbeat=null;
  ready=false;
  sequence=null;
  acknowledged=true;
  nextConnect=0;
  lastRoleError=null;
  checkedQueue=false;

  async fetch() {
    await this.ensureAlarm();
    await this.ensureConnection();
    if(!this.checkedQueue){this.checkedQueue=true;this.ctx.waitUntil(this.processQueue());}
    return Response.json({connected:this.ready,status:this.ready?'dnd':'connecting',roleError:this.lastRoleError,joinSync:true});
  }

  async ensureAlarm(){
    if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+minute);
  }

  async alarm(){
    await this.ctx.storage.setAlarm(Date.now()+minute);
    await Promise.all([
      this.ensureConnection(),
      this.processQueue()
    ]);
  }

  async processQueue(){
    try { const [result]=await Promise.all([drainDiscordJobs(this.env,8),refreshDiscordRoster(this.env,rosterBanner),prepareTickets(this.env),drainTickets(this.env)]);this.lastRoleError=result.lastError||null; }
    catch(error){this.lastRoleError=error?.name||'Queue error';}
  }

  async ensureConnection(){
    if(this.socket?.readyState===WebSocket.OPEN||Date.now()<this.nextConnect||!this.env.DISCORD_BOT_TOKEN)return;
    if(!this.connecting){
      this.connecting=this.connect().catch(()=>{
        this.nextConnect=Date.now()+minute;
        console.error('Discord Gateway connection failed');
      }).finally(()=>{this.connecting=null});
    }
    await this.connecting;
  }

  async connect(){
    const response=await fetch(gateway,{headers:{Upgrade:'websocket'}});
    const socket=response.webSocket;
    if(!socket)throw Error('Gateway refused connection');
    this.socket=socket;
    this.ready=false;
    this.sequence=null;
    this.acknowledged=true;
    socket.addEventListener('message',event=>this.message(socket,event.data));
    socket.addEventListener('close',event=>this.disconnected(socket,event.code));
    socket.addEventListener('error',()=>this.reconnect(socket));
    socket.accept();
  }

  message(socket,raw){
    if(socket!==this.socket||socket.readyState!==WebSocket.OPEN)return;
    let packet;
    try{packet=JSON.parse(raw)}catch{return}
    if(packet.s!==null&&packet.s!==undefined)this.sequence=packet.s;
    if(packet.op===10){
      const interval=packet.d?.heartbeat_interval;
      if(!Number.isFinite(interval)||interval<1000)return this.reconnect(socket);
      this.heartbeat=setTimeout(()=>{
        this.sendHeartbeat(socket);
        if(socket===this.socket)this.heartbeat=setInterval(()=>this.sendHeartbeat(socket),interval);
      },Math.random()*interval);
      socket.send(JSON.stringify({op:2,d:{
        token:this.env.DISCORD_BOT_TOKEN,intents:guildMembersIntent,properties:{os:'linux',browser:'Jevox Journal',device:'Jevox Journal'},
        presence:{since:null,activities:[],status:'dnd',afk:false},
      }}));
    }else if(packet.op===11){
      this.acknowledged=true;
    }else if(packet.op===1){
      socket.send(JSON.stringify({op:1,d:this.sequence}));
    }else if(packet.op===7||packet.op===9){
      this.reconnect(socket);
    }else if(packet.op===0&&packet.t==='READY'){
      this.ready=true;
    }else if(packet.op===0&&packet.t==='GUILD_MEMBER_ADD'){
      this.ctx.waitUntil(syncDiscordJoin(this.env,packet.d).catch(()=>console.error('Discord join role sync failed')));
    }
  }

  sendHeartbeat(socket){
    if(socket!==this.socket||socket.readyState!==WebSocket.OPEN)return;
    if(!this.acknowledged)return this.reconnect(socket);
    this.acknowledged=false;
    socket.send(JSON.stringify({op:1,d:this.sequence}));
  }

  reconnect(socket){
    if(socket===this.socket){
      this.disconnected(socket,4000);
      if(socket.readyState===WebSocket.OPEN)socket.close(4000,'Reconnect');
    }
  }

  disconnected(socket,code){
    if(socket!==this.socket)return;
    clearTimeout(this.heartbeat);
    clearInterval(this.heartbeat);
    this.heartbeat=null;
    this.socket=null;
    this.ready=false;
    this.nextConnect=Date.now()+(terminalCodes.has(code)?15*minute:5000);
    if(terminalCodes.has(code))console.error('Discord Gateway closed',code);
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method!=='GET')return new Response(null,{status:404});
    const skin=url.pathname==='/skins/discord-1pirs.png'?ownerPirs
      :url.pathname==='/skins/discord-cvasolir.png'?ownerCvasolir
      :['/skins/discord-roster-banner.png','/skins/discord-roster-banner-v2.png','/skins/discord-roster-banner-v3.png'].includes(url.pathname)?rosterBanner:null;
    if(skin)return new Response(skin,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'}});
    const ticketImage=ticketImages.get(url.pathname);
    if(ticketImage)return new Response(ticketImage,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400'}});
    if(url.pathname!=='/health')return new Response(null,{status:404});
    ctx.waitUntil(Promise.allSettled([prepareTickets(env),refreshDiscordRoster(env,rosterBanner)]));
    return env.PRESENCE.getByName('discord').fetch('https://presence.internal/health');
  },
  async scheduled(_controller,env,ctx){
    ctx.waitUntil(env.PRESENCE.getByName('discord').fetch('https://presence.internal/health'));
  },
};
