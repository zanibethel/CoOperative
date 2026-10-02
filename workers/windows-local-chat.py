# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
# ]
# ///

"""Private, loopback-only CoOperativeLocalAI for Windows Unison nodes.

The chat UI runs on the local Windows node and inference is sent only to the
node's loopback Ollama runtime. Conversation history can synchronize to the
authenticated CoOperative account using encrypted hosted history so desktop and
mobile can continue the same chats. Optional web search sends the search query
to a search provider only when the user enables Web mode. Personal inference
never enters the contributed-compute queue.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

HERE = Path(__file__).resolve().parent
READY_MARKER = HERE / "local-chat.ready"
BUSY_MARKER = HERE / "local-chat.busy"
IMAGE_PORT_MARKER = HERE / "image-worker.port"

HOST = "127.0.0.1"
PORT = int(os.getenv("UNISON_LOCAL_CHAT_PORT", "11436"))
COOPERATIVE_URL = os.getenv(
    "COOPERATIVE_QUEUE_URL",
    "https://co-operative-mu.vercel.app",
).rstrip("/")
NODE_ID = (os.getenv("UNISON_NODE_ID") or "").strip()[:160]
NODE_TOKEN = os.getenv("UNISON_NODE_TOKEN") or os.getenv("INFERENCE_WORKER_TOKEN")
OLLAMA_URL = os.getenv("UNISON_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
FAST_MODEL = os.getenv("WINDOWS_TEXT_FAST_MODEL_ID", "qwen2.5:1.5b")
QUALITY_MODEL = os.getenv("WINDOWS_TEXT_QUALITY_MODEL_ID", FAST_MODEL)
HEAVY_MODEL = os.getenv("WINDOWS_TEXT_HEAVY_MODEL_ID", QUALITY_MODEL)
VISION_MODEL = os.getenv("WINDOWS_VISION_MODEL_ID", "qwen2.5vl:3b")
MODELS = {
    "fast": FAST_MODEL,
    "quality": QUALITY_MODEL,
    "heavy": HEAVY_MODEL,
    "vision": VISION_MODEL,
}
MAX_JSON_BODY = 18 * 1024 * 1024
MAX_FILE_BODY = 25 * 1024 * 1024
MAX_AUDIO_BODY = 20 * 1024 * 1024
MAX_PROJECT_CONTEXT = 70_000

_ollama_process: subprocess.Popen | None = None
_pull_lock = threading.Lock()


HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoOperativeLocalAI</title>
<style>
:root{color-scheme:dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#07111b;color:#eef7ff;--panel:#0d1c29;--line:#223d51;--soft:#94adbf;--cyan:#9cecff}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#10334a 0,#07111b 38%);min-height:100vh}
button,input,textarea,select{font:inherit}.app{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}
.sidebar{border-right:1px solid var(--line);background:#081521;padding:18px;display:flex;flex-direction:column;gap:16px;overflow:auto}
.brand{font-weight:850;letter-spacing:.08em;font-size:1.05rem}.privacy{font-size:.82rem;color:var(--soft);line-height:1.35}.badge{display:inline-block;font-size:.72rem;padding:5px 8px;border:1px solid #315b73;border-radius:999px;color:var(--cyan);margin-top:6px}
.side-actions{display:grid;gap:8px}.btn{border:1px solid #31516a;background:#122638;color:#eef7ff;border-radius:10px;padding:9px 11px;cursor:pointer}.btn.primary{background:#dff9ff;color:#07111b;border:0;font-weight:750}.btn.small{padding:6px 8px;font-size:.82rem}.btn.danger{border-color:#70434a;color:#ffc6ca}
.section-title{font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;color:#7593a8;margin-bottom:8px}
.list{display:grid;gap:6px}.list button{width:100%;text-align:left;border:1px solid transparent;background:transparent;color:#dcecf8;padding:8px;border-radius:9px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.list button:hover,.list button.active{background:#102536;border-color:#28465c}
.main{min-width:0;display:flex;flex-direction:column;height:100vh}.topbar{padding:14px 18px;border-bottom:1px solid var(--line);background:#0a1723;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.topbar label{display:flex;gap:7px;align-items:center;font-size:.86rem;color:var(--soft)}select{background:#102334;color:#fff;border:1px solid #31516a;border-radius:9px;padding:7px 9px}
.status{margin-left:auto;color:var(--soft);font-size:.86rem}.content{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:0;flex:1}
.chat{display:flex;flex-direction:column;min-height:0}.messages{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:13px}
.msg{max-width:min(82%,780px);padding:12px 14px;border-radius:16px;white-space:pre-wrap;line-height:1.48;word-break:break-word}.msg.user{align-self:flex-end;background:#164963}.msg.assistant{align-self:flex-start;background:#152735}.msg-meta{font-size:.72rem;color:#8fa8ba;margin-top:7px}.bubble-actions{display:flex;gap:6px;margin-top:8px}.bubble-actions button{border:0;background:transparent;color:#9ecfe9;cursor:pointer;padding:0;font-size:.78rem}
.sources{margin-top:9px;display:grid;gap:4px}.sources a{color:#9cecff;font-size:.78rem;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.generated-image{display:block;max-width:min(100%,720px);max-height:720px;border-radius:13px;margin-top:10px;border:1px solid #294a60;object-fit:contain;background:#07131e}
.empty{margin:auto;color:#8da6b8;text-align:center;max-width:520px;line-height:1.5}.composer-wrap{border-top:1px solid var(--line);padding:12px;background:#091723}.attachments{display:flex;gap:8px;overflow:auto;margin-bottom:8px}.chip{display:flex;align-items:center;gap:6px;border:1px solid #31516a;background:#102536;padding:6px 8px;border-radius:999px;font-size:.78rem;white-space:nowrap}.chip button{border:0;background:transparent;color:#fff;cursor:pointer}
.composer{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:end}.composer textarea{resize:vertical;min-height:64px;max-height:180px;border:1px solid #31516a;background:#07131e;color:#fff;border-radius:12px;padding:11px}
.icon-btn{height:44px;min-width:44px;border:1px solid #31516a;background:#102536;color:#fff;border-radius:11px;cursor:pointer}.send{height:44px;border:0;background:#dff9ff;color:#07111b;font-weight:800;border-radius:11px;padding:0 18px;cursor:pointer}
.project{border-left:1px solid var(--line);background:#0a1723;padding:16px;overflow:auto}.project.hidden{display:none}.project h3{margin:0 0 6px}.muted{color:var(--soft);font-size:.84rem}.project textarea{width:100%;min-height:96px;background:#07131e;border:1px solid #31516a;color:#fff;border-radius:10px;padding:9px}
.project-row{display:flex;gap:7px;align-items:center;margin:8px 0}.project-row input[type=text]{flex:1;background:#07131e;border:1px solid #31516a;color:#fff;border-radius:9px;padding:7px}
.project-files,.tasks{display:grid;gap:7px;margin-top:8px}.file-row,.task-row{display:flex;gap:7px;align-items:flex-start;border:1px solid #244055;border-radius:9px;padding:7px;font-size:.8rem}.file-row span,.task-row span{flex:1;min-width:0;word-break:break-word}
.error{color:#ffb6bc;font-size:.85rem;padding:0 12px}.web-warning{font-size:.74rem;color:#d7bd82}
@media(max-width:900px){.app{grid-template-columns:1fr}.sidebar{display:none}.content{grid-template-columns:1fr}.project{position:absolute;right:0;top:58px;bottom:0;width:min(90vw,340px);z-index:5;box-shadow:-20px 0 50px #0008}.msg{max-width:94%}.composer{grid-template-columns:auto 1fr auto}.send{grid-column:3}.voice-reply{display:none}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div>
      <div class="brand">CoOperativeLocalAI</div>
      <div class="privacy">Inference runs on this PC. Chat history syncs encrypted to your authenticated CoOperative account so you can continue on mobile.</div>
      <span class="badge">LOCAL INFERENCE</span>
    </div>
    <div class="side-actions">
      <button class="btn primary" id="newChat">＋ New chat</button>
      <button class="btn" id="newProject">＋ New project</button>
    </div>
    <div>
      <div class="section-title">Projects</div>
      <div class="list" id="projects"></div>
    </div>
    <div>
      <div class="section-title">Local history</div>
      <div class="list" id="history"></div>
    </div>
  </aside>

  <main class="main">
    <div class="topbar">
      <label>Model
        <select id="modelMode">
          <option value="auto">Auto</option>
          <option value="fast">Fast</option>
          <option value="quality">Quality</option>
          <option value="heavy">Heavy</option>
        </select>
      </label>
      <label>Web
        <select id="webMode">
          <option value="off">Off</option>
          <option value="auto">Auto when current info is needed</option>
          <option value="always">Search every message</option>
        </select>
      </label>
      <button class="btn small voice-reply" id="voiceReply">Voice replies: Off</button>
      <button class="btn small" id="projectToggle">Project</button>
      <span class="web-warning" id="webWarning"></span>
      <span class="status" id="status">Ready</span>
    </div>

    <div class="content">
      <section class="chat">
        <div class="messages" id="messages"></div>
        <div class="composer-wrap">
          <div class="attachments" id="attachments"></div>
          <div class="composer">
            <button class="icon-btn" id="attach" title="Attach images or files">＋</button>
            <textarea id="input" placeholder="Ask your CoOperativeLocalAI…"></textarea>
            <button class="icon-btn" id="mic" title="Speak">🎤</button>
            <button class="send" id="send">Send</button>
          </div>
          <input id="fileInput" type="file" multiple hidden
            accept="image/*,.pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.md,.markdown,.csv,.json,.jsonl,.xml,.html,.py,.js,.jsx,.ts,.tsx,.css,.sql,.ps1,.sh,.java,.cs,.cpp,.c,.h,.go,.rs,.yaml,.yml,.toml,.ini,.log">
          <div class="error" id="error"></div>
        </div>
      </section>

      <aside class="project hidden" id="projectPanel">
        <div id="noProject" class="muted">Create or select a project to keep project instructions, files, tasks, and related chats together on this Windows profile.</div>
        <div id="projectBody" hidden>
          <div class="project-row"><input id="projectName" type="text"><button class="btn small" id="saveProject">Save</button></div>
          <div class="section-title">Project instructions</div>
          <textarea id="projectInstructions" placeholder="Goals, conventions, requirements, important context…"></textarea>
          <div class="project-row">
            <button class="btn small" id="projectFiles">Add files</button>
            <button class="btn small danger" id="deleteProject">Delete project</button>
          </div>
          <div class="section-title">Project files</div>
          <div class="project-files" id="projectFileList"></div>
          <div class="section-title" style="margin-top:16px">Tasks</div>
          <div class="project-row"><input id="taskInput" type="text" placeholder="Add a task"><button class="btn small" id="addTask">Add</button></div>
          <div class="tasks" id="tasks"></div>
        </div>
      </aside>
    </div>
  </main>
</div>

<script>
const STATE_KEY="cooperative.unison.personal-ai.v3";
const DB_NAME="cooperative-unison-personal-ai";
const DB_VERSION=1;
const $=id=>document.getElementById(id);
const uid=()=>crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36);
let state={projects:[],conversations:[],activeProjectId:null,activeConversationId:null,modelMode:"auto",webMode:"off",voiceReply:false};
let pending=[];
let recording=false, recorder=null, recordedChunks=[];

function loadState(){
  try{const v=JSON.parse(localStorage.getItem(STATE_KEY)||"null");if(v&&typeof v==="object")state={...state,...v}}catch{}
  if(!Array.isArray(state.projects))state.projects=[];
  if(!Array.isArray(state.conversations))state.conversations=[];
  $("modelMode").value=state.modelMode||"auto";
  $("webMode").value=state.webMode||"off";
  updateWebWarning();updateVoiceButton();
}
function saveState(){localStorage.setItem(STATE_KEY,JSON.stringify(state))}
function currentProject(){return state.projects.find(p=>p.id===state.activeProjectId)||null}
function currentConversation(){return state.conversations.find(c=>c.id===state.activeConversationId)||null}
function newConversation(){
  const c={id:uid(),hostedId:null,title:"New chat",projectId:state.activeProjectId||null,messages:[],createdAt:Date.now(),updatedAt:Date.now()};
  state.conversations.unshift(c);state.activeConversationId=c.id;saveState();renderAll();$("input").focus();return c;
}
function ensureConversation(){return currentConversation()||newConversation()}
function escapeText(value){return String(value??"")}

function renderAll(){renderProjects();renderHistory();renderMessages();renderProject();renderAttachments();status()}
function renderProjects(){
  const box=$("projects");box.innerHTML="";
  const all=document.createElement("button");all.textContent="No project";if(!state.activeProjectId)all.className="active";
  all.onclick=()=>{state.activeProjectId=null;saveState();renderAll()};box.appendChild(all);
  for(const p of state.projects){const b=document.createElement("button");b.textContent=p.name||"Untitled project";if(p.id===state.activeProjectId)b.className="active";b.onclick=()=>{state.activeProjectId=p.id;const recent=state.conversations.find(c=>c.projectId===p.id);state.activeConversationId=recent?.id||null;saveState();renderAll()};box.appendChild(b)}
}
function renderHistory(){
  const box=$("history");box.innerHTML="";
  const rows=state.conversations.filter(c=>state.activeProjectId?c.projectId===state.activeProjectId:true).slice(0,40);
  for(const c of rows){const b=document.createElement("button");b.textContent=c.title||"Chat";if(c.id===state.activeConversationId)b.className="active";b.onclick=()=>void selectConversation(c);box.appendChild(b)}
}

const PROFILE_TOKEN_KEY="cooperative-local-profile-token";
function loadProfileToken(){
  const hash=new URLSearchParams(location.hash.startsWith("#")?location.hash.slice(1):location.hash);
  const supplied=hash.get("profileToken");
  if(supplied){
    localStorage.setItem(PROFILE_TOKEN_KEY,supplied);
    history.replaceState(null,"",location.pathname+location.search);
    return supplied;
  }
  return localStorage.getItem(PROFILE_TOKEN_KEY)||"";
}
let cooperativeProfileToken=loadProfileToken();
async function hostedRequest(path="",options={}){
  const headers={...(options.headers||{})};
  if(cooperativeProfileToken)headers["X-Cooperative-Profile-Token"]=cooperativeProfileToken;
  const r=await fetch("/api/hosted-history"+path,{cache:"no-store",...options,headers});
  const j=await r.json();
  if(!r.ok)throw new Error(j.error||"Hosted history sync failed.");
  return j;
}
async function selectConversation(c){
  state.activeConversationId=c.id;state.activeProjectId=c.projectId||null;
  if(c.hostedId){
    try{
      const j=await hostedRequest("?conversationId="+encodeURIComponent(c.hostedId));
      c.title=j.conversation?.title||c.title;
      c.hostedUpdatedAt=j.conversation?.updatedAt||c.hostedUpdatedAt;
      c.messages=(j.messages||[]).map(m=>({role:m.role,content:m.content,hostedMessageId:m.id,createdAt:m.createdAt}));
    }catch(e){$("error").textContent=e.message||String(e)}
  }
  saveState();renderAll();
}
async function syncHostedHistory(){
  try{
    const j=await hostedRequest();
    for(const remote of (j.conversations||[])){
      let c=state.conversations.find(x=>x.hostedId===remote.id||x.id===remote.id);
      if(!c){
        c={id:remote.id,hostedId:remote.id,title:remote.title||"CoOperativeLocalAI",projectId:null,messages:[],createdAt:Date.parse(remote.createdAt||"")||Date.now(),updatedAt:Date.parse(remote.updatedAt||"")||Date.now(),hostedUpdatedAt:remote.updatedAt};
        state.conversations.unshift(c);
      }else{
        c.hostedId=remote.id;c.title=remote.title||c.title;c.hostedUpdatedAt=remote.updatedAt||c.hostedUpdatedAt;
      }
    }
    saveState();renderHistory();
  }catch{}
}
async function ensureHostedConversation(c,title){
  if(c.hostedId)return c.hostedId;
  const j=await hostedRequest("",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",title:String(title||c.title||"New chat").slice(0,160)})});
  c.hostedId=j.conversationId;c.hostedUpdatedAt=new Date().toISOString();saveState();return c.hostedId;
}
async function appendHostedMessage(c,role,content,metadata={}){
  if(!c.hostedId)return;
  await hostedRequest("",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"append",conversationId:c.hostedId,role,content,metadata})});
  c.hostedUpdatedAt=new Date().toISOString();saveState();
}
function renderMessages(){
  const box=$("messages");box.innerHTML="";const c=currentConversation();
  if(!c||!c.messages.length){const e=document.createElement("div");e.className="empty";e.innerHTML="<strong>Your AI runs here.</strong><br>Chat, attach images or documents, use voice, search the web when you choose, or work inside a local project.";box.appendChild(e);return}
  for(const m of c.messages){
    const d=document.createElement("div");d.className="msg "+(m.role==="user"?"user":"assistant");
    const text=document.createElement("div");text.textContent=m.content;d.appendChild(text);
    if(m.attachments?.length){const meta=document.createElement("div");meta.className="msg-meta";meta.textContent="Attachments: "+m.attachments.join(", ");d.appendChild(meta)}
    if(m.role==="assistant"){
      if(m.imageId){
        const img=document.createElement("img");img.className="generated-image";img.alt=m.imageAlt||"Locally generated image";d.appendChild(img);
        dbGet(m.imageId).then(item=>{if(item?.data)img.src=item.data}).catch(()=>{});
      }
      const actions=document.createElement("div");actions.className="bubble-actions";
      const speak=document.createElement("button");speak.textContent="Speak";speak.onclick=()=>speakText(m.content);actions.appendChild(speak);
      const copy=document.createElement("button");copy.textContent="Copy";copy.onclick=()=>navigator.clipboard.writeText(m.content);actions.appendChild(copy);
      if(m.imageId){
        const save=document.createElement("button");save.textContent="Save image";save.onclick=async()=>{const item=await dbGet(m.imageId);if(!item?.data)return;const a=document.createElement("a");a.href=item.data;a.download=item.name||"cooperative-local-image.png";a.click()};actions.appendChild(save);
        const reuse=document.createElement("button");reuse.textContent="Use as reference";reuse.onclick=async()=>{const item=await dbGet(m.imageId);if(!item?.data)return;pending.push({id:uid(),name:item.name||"generated-image.png",kind:"image",data:item.data.split(",",2).pop(),size:0,createdAt:Date.now()});renderAttachments()};actions.appendChild(reuse);
      }
      d.appendChild(actions);
      if(m.sources?.length){const src=document.createElement("div");src.className="sources";for(const s of m.sources){const a=document.createElement("a");a.href=s.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=s.title||s.url;src.appendChild(a)}d.appendChild(src)}
    }
    if(m.meta){const meta=document.createElement("div");meta.className="msg-meta";meta.textContent=m.meta;d.appendChild(meta)}
    box.appendChild(d)
  }
  box.scrollTop=box.scrollHeight;
}
function renderAttachments(){
  const box=$("attachments");box.innerHTML="";
  for(const item of pending){const chip=document.createElement("div");chip.className="chip";const s=document.createElement("span");s.textContent=(item.kind==="image"?"🖼 ":"📄 ")+item.name;chip.appendChild(s);const x=document.createElement("button");x.textContent="×";x.onclick=()=>{pending=pending.filter(v=>v.id!==item.id);renderAttachments()};chip.appendChild(x);box.appendChild(chip)}
}
async function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("files"))r.result.createObjectStore("files",{keyPath:"id"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function dbPut(value){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction("files","readwrite");t.objectStore("files").put(value);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error)})}
async function dbGet(id){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction("files").objectStore("files").get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
async function dbDelete(id){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction("files","readwrite");t.objectStore("files").delete(id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error)})}

function renderProject(){
  const p=currentProject();$("noProject").hidden=!!p;$("projectBody").hidden=!p;
  if(!p)return;
  $("projectName").value=p.name||"";$("projectInstructions").value=p.instructions||"";
  const files=$("projectFileList");files.innerHTML="";
  for(const f of p.files||[]){const row=document.createElement("div");row.className="file-row";const s=document.createElement("span");s.textContent=(f.kind==="image"?"🖼 ":"📄 ")+f.name;row.appendChild(s);
    if(f.kind==="image"){const use=document.createElement("button");use.className="btn small";use.textContent="Attach";use.onclick=async()=>{const item=await dbGet(f.id);if(item&&!pending.some(x=>x.id===item.id)){pending.push(item);renderAttachments()}};row.appendChild(use)}
    const x=document.createElement("button");x.className="btn small";x.textContent="Remove";x.onclick=async()=>{p.files=(p.files||[]).filter(v=>v.id!==f.id);await dbDelete(f.id);saveState();renderProject()};row.appendChild(x);files.appendChild(row)}
  const tasks=$("tasks");tasks.innerHTML="";
  for(const t of p.tasks||[]){const row=document.createElement("div");row.className="task-row";const cb=document.createElement("input");cb.type="checkbox";cb.checked=!!t.done;cb.onchange=()=>{t.done=cb.checked;saveState()};const s=document.createElement("span");s.textContent=t.text;if(t.done)s.style.textDecoration="line-through";row.append(cb,s);const x=document.createElement("button");x.className="btn small";x.textContent="×";x.onclick=()=>{p.tasks=p.tasks.filter(v=>v.id!==t.id);saveState();renderProject()};row.appendChild(x);tasks.appendChild(row)}
}
function updateWebWarning(){$("webWarning").textContent=$("webMode").value==="off"?"": "Web mode sends search terms to an external search service; inference stays local."}
function updateVoiceButton(){$("voiceReply").textContent="Voice replies: "+(state.voiceReply?"On":"Off")}

async function compressImage(file){
  const data=await file.arrayBuffer();const blob=new Blob([data],{type:file.type||"image/jpeg"});const bitmap=await createImageBitmap(blob);
  const max=1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const out=await new Promise(r=>canvas.toBlob(r,"image/jpeg",.86));const buf=await out.arrayBuffer();const bytes=new Uint8Array(buf);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)
}
async function extractFile(file){
  const r=await fetch("/api/extract?name="+encodeURIComponent(file.name),{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});
  const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not read "+file.name);return j
}
async function handleFiles(files,storeInProject=false){
  $("error").textContent="";$("status").textContent="Reading files locally…";
  try{
    for(const file of [...files].slice(0,8)){
      let item={id:uid(),name:file.name,type:file.type,size:file.size,kind:"text",createdAt:Date.now()};
      if(file.type.startsWith("image/")){item.kind="image";item.data=await compressImage(file)}
      else{const x=await extractFile(file);item.kind="text";item.text=x.text;item.documentKind=x.kind}
      const p=currentProject();
      if(storeInProject&&p){await dbPut(item);p.files=p.files||[];p.files.push({id:item.id,name:item.name,kind:item.kind,size:item.size});saveState()}
      else{pending.push(item)}
    }
  }catch(e){$("error").textContent=e.message||String(e)}
  finally{$("status").textContent="Ready";renderAll();$("fileInput").value=""}
}
async function projectContext(){
  const p=currentProject();if(!p)return {instructions:"",tasks:[],files:[],images:[]};
  const files=[],images=[];let used=0;
  for(const ref of p.files||[]){const item=await dbGet(ref.id);if(!item)continue;
    if(item.kind==="text"&&used<60000){const text=(item.text||"").slice(0,Math.max(0,60000-used));files.push({name:item.name,text});used+=text.length}
  }
  return {name:p.name,instructions:p.instructions||"",tasks:(p.tasks||[]).map(t=>({text:t.text,done:!!t.done})),files,images}
}
async function send(){
  const input=$("input"),text=input.value.trim();if(!text&&!pending.length)return;
  $("error").textContent="";const c=ensureConversation();const names=pending.map(x=>x.name);
  const userText=text||"Please analyze the attached item(s).";
  if(c.title==="New chat")c.title=userText.slice(0,46);
  try{await ensureHostedConversation(c,userText);await appendHostedMessage(c,"user",userText,{attachments:names})}catch(e){console.warn("Hosted history sync unavailable",e)}
  c.messages.push({role:"user",content:userText,attachments:names});c.updatedAt=Date.now();input.value="";saveState();renderAll();
  $("send").disabled=true;$("status").textContent="Choosing the best local model…";
  try{
    const project=await projectContext();
    const images=[...project.images.map(x=>x.data),...pending.filter(x=>x.kind==="image").map(x=>x.data)].slice(0,4);
    const oneOffFiles=pending.filter(x=>x.kind==="text").map(x=>({name:x.name,text:(x.text||"").slice(0,45000)}));
    const messages=c.messages.slice(-24).map(m=>({role:m.role,content:m.content}));
    const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      modelMode:$("modelMode").value,webMode:$("webMode").value,messages,images,
      project:{name:project.name||"",instructions:project.instructions,tasks:project.tasks,files:[...project.files,...oneOffFiles]}
    })});
    const j=await r.json();if(!r.ok)throw new Error(j.error||"Local AI request failed.");
    const meta=[j.modelReason,j.model,j.tokensPerSecond?j.tokensPerSecond.toFixed(1)+" tok/s":null,j.webSearchUsed?"web search used":null,j.imageGenerated?"image generated locally":null].filter(Boolean).join(" · ");
    let imageId=null;
    if(j.generatedImage?.dataUrl){
      imageId=uid();
      await dbPut({id:imageId,kind:"generated-image",name:"cooperative-local-image-"+Date.now()+".png",data:j.generatedImage.dataUrl,createdAt:Date.now(),model:j.generatedImage.model||j.model});
    }
    c.messages.push({role:"assistant",content:j.text,meta,sources:j.webResults||[],imageId,imageAlt:j.generatedImage?.prompt||"Locally generated image"});c.updatedAt=Date.now();pending=[];saveState();renderAll();
    try{await appendHostedMessage(c,"assistant",j.text,{model:j.model||null,profile:j.profile||null,webSearchUsed:!!j.webSearchUsed,imageGenerated:!!j.imageGenerated})}catch(e){console.warn("Hosted history sync unavailable",e)}
    if(state.voiceReply&&!j.imageGenerated)void speakText(j.text);
  }catch(e){$("error").textContent=e.message||String(e)}
  finally{$("send").disabled=false;$("status").textContent="Ready";renderAttachments();input.focus()}
}
async function speakText(text){
  try{$("status").textContent="Speaking locally…";const r=await fetch("/api/voice/speak",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:String(text).slice(0,5000)})});if(!r.ok){const j=await r.json();throw new Error(j.error||"Speech failed")}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=new Audio(url);a.onended=()=>URL.revokeObjectURL(url);await a.play()}catch(e){$("error").textContent=e.message||String(e)}finally{$("status").textContent="Ready"}
}
async function toggleMic(){
  if(recording){recorder.stop();return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordedChunks=[];recorder=new MediaRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data)};
    recorder.onstop=async()=>{recording=false;$("mic").textContent="🎤";stream.getTracks().forEach(t=>t.stop());const blob=new Blob(recordedChunks,{type:recorder.mimeType||"audio/webm"});$("status").textContent="Transcribing locally…";
      try{const r=await fetch("/api/voice/transcribe",{method:"POST",headers:{"Content-Type":blob.type},body:blob});const j=await r.json();if(!r.ok)throw new Error(j.error||"Transcription failed");$("input").value=($("input").value+" "+j.text).trim()}catch(e){$("error").textContent=e.message||String(e)}finally{$("status").textContent="Ready";$("input").focus()}
    };
    recorder.start();recording=true;$("mic").textContent="■";$("status").textContent="Listening…";
  }catch(e){$("error").textContent=e.message||String(e)}
}
async function status(){
  try{const r=await fetch("/api/status",{cache:"no-store"});const j=await r.json();if(j.models){$("status").title="Fast: "+j.models.fast+" | Quality: "+j.models.quality+" | Heavy: "+j.models.heavy+" | Vision: "+j.models.vision}}catch{}
}

$("newChat").onclick=()=>newConversation();
$("newProject").onclick=()=>{const name=prompt("Project name");if(!name)return;const p={id:uid(),name:name.trim(),instructions:"",tasks:[],files:[],createdAt:Date.now()};state.projects.unshift(p);state.activeProjectId=p.id;state.activeConversationId=null;saveState();renderAll();$("projectPanel").classList.remove("hidden")};
$("saveProject").onclick=()=>{const p=currentProject();if(!p)return;p.name=$("projectName").value.trim()||"Untitled project";p.instructions=$("projectInstructions").value;saveState();renderAll()};
$("deleteProject").onclick=async()=>{const p=currentProject();if(!p||!confirm("Delete this local project, its cached files, and its project chats?"))return;for(const f of p.files||[])await dbDelete(f.id);state.projects=state.projects.filter(x=>x.id!==p.id);state.conversations=state.conversations.filter(c=>c.projectId!==p.id);state.activeProjectId=null;state.activeConversationId=null;saveState();renderAll()};
$("addTask").onclick=()=>{const p=currentProject(),v=$("taskInput").value.trim();if(!p||!v)return;p.tasks=p.tasks||[];p.tasks.push({id:uid(),text:v,done:false});$("taskInput").value="";saveState();renderProject()};
$("attach").onclick=()=>{$("fileInput").dataset.project="false";$("fileInput").click()};
$("projectFiles").onclick=()=>{$("fileInput").dataset.project="true";$("fileInput").click()};
$("fileInput").onchange=e=>handleFiles(e.target.files,e.target.dataset.project==="true");
$("send").onclick=send;$("input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
$("mic").onclick=toggleMic;$("projectToggle").onclick=()=>$("projectPanel").classList.toggle("hidden");
$("modelMode").onchange=()=>{state.modelMode=$("modelMode").value;saveState()};
$("webMode").onchange=()=>{state.webMode=$("webMode").value;saveState();updateWebWarning()};
$("voiceReply").onclick=()=>{state.voiceReply=!state.voiceReply;saveState();updateVoiceButton()};
loadState();if(!state.activeConversationId&&state.conversations.length)state.activeConversationId=state.conversations[0].id;renderAll();void syncHostedHistory();setInterval(()=>void syncHostedHistory(),15000);$("input").focus();
</script>
</body>
</html>
"""


def allowed_origin(value: str | None) -> bool:
    if not value:
        return True
    try:
        parsed = urlparse(value)
        return parsed.hostname in {"127.0.0.1", "localhost"} and parsed.port == PORT
    except Exception:
        return False


def uv_executable() -> str:
    configured = os.getenv("UNISON_SHARED_UV_EXE")
    if configured and Path(configured).is_file():
        return configured
    direct = shutil.which("uv")
    if direct:
        return direct
    candidate = Path(os.getenv("USERPROFILE", "")) / ".local" / "bin" / "uv.exe"
    if candidate.is_file():
        return str(candidate)
    raise RuntimeError("The Unison Python runtime is unavailable.")


def run_helper(name: str, args: list[str], timeout: float | None = None) -> dict:
    helper = HERE / name
    if not helper.is_file():
        raise RuntimeError(f"CoOperativeLocalAI helper {name} is missing. Run Repair connection.")
    process = subprocess.run(
        [uv_executable(), "run", str(helper), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(HERE),
        env=os.environ.copy(),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    output = (process.stdout or "").strip().splitlines()
    payload = {}
    if output:
        try:
            payload = json.loads(output[-1])
        except json.JSONDecodeError:
            payload = {}
    if process.returncode != 0:
        detail = payload.get("error") if isinstance(payload, dict) else None
        detail = detail or (process.stderr or "").strip().splitlines()[-1:] or ["Helper failed."]
        if isinstance(detail, list):
            detail = detail[0]
        raise RuntimeError(str(detail)[:700])
    return payload if isinstance(payload, dict) else {}


def hosted_history_request(
    method: str = "GET",
    conversation_id: str | None = None,
    payload: dict | None = None,
    profile_token: str | None = None,
) -> dict:
    if not NODE_ID or not NODE_TOKEN:
        raise RuntimeError("This CoOperativeLocalAI is not linked to a Unison node.")
    if not profile_token:
        raise RuntimeError(
            "This Windows profile is not linked to a CoOperative user yet. "
            "Run the Unison installer once from this Windows profile."
        )

    url = f"{COOPERATIVE_URL}/api/personal-ai/node/history"
    params = {"nodeId": NODE_ID}
    if conversation_id:
        params["conversationId"] = conversation_id

    response = httpx.request(
        method,
        url,
        params=params if method == "GET" else None,
        headers={
            "Authorization": f"Bearer {NODE_TOKEN}",
            "X-Cooperative-Profile-Token": profile_token,
            "Content-Type": "application/json",
        },
        json=payload if method != "GET" else None,
        timeout=30.0,
        follow_redirects=True,
    )
    if not response.is_success:
        try:
            detail = response.json().get("detail") or response.json().get("error")
        except Exception:
            detail = response.text
        raise RuntimeError(str(detail or "Hosted history sync failed.")[:700])
    value = response.json()
    return value if isinstance(value, dict) else {}


def device_link_proof() -> dict:
    if not NODE_ID or not NODE_TOKEN:
        raise RuntimeError("This PC is not linked to a Unison node.")

    response = httpx.post(
        f"{COOPERATIVE_URL}/api/unison/nodes/link-proof",
        headers={
            "Authorization": f"Bearer {NODE_TOKEN}",
            "Content-Type": "application/json",
        },
        json={"nodeId": NODE_ID},
        timeout=30.0,
        follow_redirects=True,
    )
    if not response.is_success:
        try:
            detail = response.json().get("detail") or response.json().get("error")
        except Exception:
            detail = response.text
        raise RuntimeError(str(detail or "Could not authorize this local PC.")[:700])

    value = response.json()
    return value if isinstance(value, dict) else {}


def ollama_executable() -> str | None:
    configured = os.getenv("UNISON_OLLAMA_EXE")
    if configured and Path(configured).is_file():
        return configured
    direct = shutil.which("ollama")
    if direct:
        return direct
    candidates = [
        Path(os.getenv("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
        Path(os.getenv("PROGRAMFILES", "")) / "Ollama" / "ollama.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def ollama_ready() -> bool:
    try:
        return httpx.get(f"{OLLAMA_URL}/api/version", timeout=2.5).is_success
    except Exception:
        return False


def ensure_ollama() -> None:
    global _ollama_process
    if ollama_ready():
        return
    executable = ollama_executable()
    if not executable:
        raise RuntimeError("The local model runtime is not installed yet.")
    _ollama_process = subprocess.Popen(
        [executable, "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        env=os.environ.copy(),
    )
    deadline = time.time() + 30
    while time.time() < deadline:
        if ollama_ready():
            return
        if _ollama_process.poll() is not None:
            break
        time.sleep(0.5)
    raise RuntimeError("The local model runtime did not start.")


def ensure_model(model: str) -> None:
    ensure_ollama()
    with _pull_lock:
        try:
            tags = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=10).json()
            names = {
                str(item.get("name") or "")
                for item in tags.get("models", [])
                if isinstance(item, dict)
            }
            if model in names or any(name.startswith(f"{model}:") for name in names):
                return
        except Exception:
            pass
        response = httpx.post(
            f"{OLLAMA_URL}/api/pull",
            json={"name": model, "stream": False},
            timeout=None,
        )
        response.raise_for_status()


def clean_messages(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value[-30:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        text = content.strip()
        if text:
            cleaned.append({"role": role, "content": text[:20_000]})
    return cleaned


def clean_images(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value[:4]:
        if isinstance(item, str) and 10 < len(item) <= 5_000_000:
            cleaned.append(item.split(",", 1)[-1])
    return cleaned


def project_context(value: object) -> tuple[str, int]:
    if not isinstance(value, dict):
        return "", 0
    name = str(value.get("name") or "").strip()[:200]
    instructions = str(value.get("instructions") or "").strip()[:12_000]
    tasks = value.get("tasks") if isinstance(value.get("tasks"), list) else []
    files = value.get("files") if isinstance(value.get("files"), list) else []
    parts = []
    if name:
        parts.append(f"PROJECT: {name}")
    if instructions:
        parts.append(f"PROJECT INSTRUCTIONS:\\n{instructions}")
    if tasks:
        task_lines = []
        for task in tasks[:80]:
            if isinstance(task, dict):
                label = str(task.get("text") or "").strip()[:500]
                if label:
                    task_lines.append(f"- [{'x' if task.get('done') else ' '}] {label}")
        if task_lines:
            parts.append("PROJECT TASKS:\\n" + "\\n".join(task_lines))
    used = sum(len(part) for part in parts)
    for file in files[:24]:
        if used >= MAX_PROJECT_CONTEXT or not isinstance(file, dict):
            break
        name = str(file.get("name") or "file")[:240]
        text = str(file.get("text") or "")
        remaining = MAX_PROJECT_CONTEXT - used
        if remaining <= 0:
            break
        excerpt = text[:remaining]
        if excerpt.strip():
            section = f"PROJECT FILE: {name}\\n{excerpt}"
            parts.append(section)
            used += len(section)
    combined = "\\n\\n".join(parts)[:MAX_PROJECT_CONTEXT]
    return combined, len(combined)


def latest_user_text(messages: list[dict]) -> str:
    for item in reversed(messages):
        if item.get("role") == "user":
            return str(item.get("content") or "")
    return ""


def needs_web(query: str) -> bool:
    lower = query.lower()
    triggers = (
        "search the web", "look online", "latest", "today", "current ", "currently",
        "news", "weather", "price", "prices", "score", "scores", "schedule",
        "release", "released", "version", "update", "updates", "this week",
        "this month", "right now", "recent",
    )
    return any(trigger in lower for trigger in triggers)


def wants_image_generation(query: str) -> bool:
    lower = " ".join(query.lower().split())
    exclusions = (
        "analyze this image", "analyze the image", "describe this image",
        "describe the image", "what is in this image", "what's in this image",
        "read this image", "look at this image", "draw a conclusion",
        "draw a comparison",
    )
    if any(phrase in lower for phrase in exclusions):
        return False
    triggers = (
        "generate an image", "generate a picture", "create an image",
        "create a picture", "make an image", "make a picture",
        "make me an image", "make me a picture", "draw me ",
        "draw a picture", "draw an image", "render an image",
        "render a picture", "illustrate ", "create artwork",
        "generate artwork",
    )
    return any(phrase in lower for phrase in triggers)


def image_aspect_ratio(query: str) -> str:
    lower = query.lower()
    for ratio in ("1:1", "4:5", "3:2", "16:9", "9:16"):
        if ratio in lower:
            return ratio
    if any(term in lower for term in ("phone wallpaper", "story format", "tiktok", "reel")):
        return "9:16"
    if any(term in lower for term in ("widescreen", "landscape", "desktop wallpaper")):
        return "16:9"
    if any(term in lower for term in ("portrait", "vertical")):
        return "4:5"
    if "square" in lower:
        return "1:1"
    return "1:1"


def image_profile(query: str, has_reference: bool) -> str:
    lower = query.lower()
    if has_reference:
        return "quality"
    quality_terms = (
        "high quality", "photorealistic", "photo realistic", "realistic",
        "detailed", "cinematic", "professional", "premium",
    )
    return "quality" if any(term in lower for term in quality_terms) else "fast"


def image_variation_mode(query: str, has_reference: bool) -> str:
    if not has_reference:
        return "balanced"
    lower = query.lower()
    if any(term in lower for term in ("keep the same", "preserve", "minor change", "small change")):
        return "preserve"
    if any(term in lower for term in ("new scene", "different scene", "new setting", "different setting")):
        return "new-scene"
    return "balanced"


def image_worker_url() -> str:
    override = os.getenv("UNISON_IMAGE_WORKER_URL", "").strip().rstrip("/")
    if override:
        parsed = urlparse(override)
        if parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise RuntimeError("Personal image generation must use a loopback image worker.")
        return override

    if not IMAGE_PORT_MARKER.is_file():
        raise RuntimeError(
            "The local image generator is still starting or unavailable. "
            "Wait for the Unison image runtime to finish and try again."
        )
    try:
        port = int(IMAGE_PORT_MARKER.read_text(encoding="utf-8").strip())
    except Exception as exc:
        raise RuntimeError("The local image generator port marker is invalid.") from exc
    if port < 1024 or port > 65535:
        raise RuntimeError("The local image generator port is invalid.")
    url = f"http://127.0.0.1:{port}"
    try:
        health = httpx.get(f"{url}/health", timeout=2.5)
        health.raise_for_status()
    except Exception as exc:
        raise RuntimeError(
            "The local image generator is still starting or unavailable. Try again shortly."
        ) from exc
    return url


def generate_local_image(query: str, images: list[str]) -> dict:
    token = os.getenv("UNISON_NODE_TOKEN") or os.getenv("INFERENCE_WORKER_TOKEN")
    if not token:
        raise RuntimeError("The protected local image-worker credential is unavailable.")

    references = [
        {"dataUrl": f"data:image/jpeg;base64,{image}", "title": f"reference-{index + 1}"}
        for index, image in enumerate(images[:1])
    ]
    profile = image_profile(query, bool(references))
    response = httpx.post(
        f"{image_worker_url()}/v1/images/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "prompt": query[:6000],
            "aspectRatio": image_aspect_ratio(query),
            "profile": profile,
            "references": references,
            "variationMode": image_variation_mode(query, bool(references)),
        },
        timeout=None,
    )
    if not response.is_success:
        try:
            detail = response.json().get("detail")
        except Exception:
            detail = response.text
        raise RuntimeError(str(detail or "Local image generation failed.")[:800])
    result = response.json()
    if not isinstance(result, dict) or not str(result.get("dataUrl") or "").startswith("data:image/"):
        raise RuntimeError("The local image generator returned an invalid image.")
    return result


def select_model(
    mode: str,
    messages: list[dict],
    *,
    image_count: int,
    context_chars: int,
    web_used: bool,
) -> tuple[str, str, str]:
    if image_count:
        return VISION_MODEL, "vision", "Vision selected because image input is attached."

    if mode in {"fast", "quality", "heavy"}:
        return MODELS[mode], mode, f"{mode.title()} model selected manually."

    query = latest_user_text(messages)
    lower = query.lower()
    score = 0
    if len(query) > 1200:
        score += 1
    if len(query) > 5000:
        score += 2
    if context_chars > 6_000:
        score += 1
    if context_chars > 24_000:
        score += 2
    if web_used:
        score += 1

    quality_terms = (
        "analyze", "compare", "explain why", "plan", "debug", "code", "program",
        "project", "design", "architecture", "essay", "research", "reason",
    )
    heavy_terms = (
        "deeply", "thorough", "complex", "refactor", "root cause", "strategy",
        "step by step", "multi-step", "review this project", "large file",
    )
    if any(term in lower for term in quality_terms):
        score += 1
    if any(term in lower for term in heavy_terms):
        score += 2

    if score >= 5:
        return HEAVY_MODEL, "heavy", "Auto chose Heavy for a high-context or complex task."
    if score >= 2:
        return QUALITY_MODEL, "quality", "Auto chose Quality for a reasoning/context-heavy task."
    return FAST_MODEL, "fast", "Auto chose Fast for a lightweight request."


def web_search(query: str) -> list[dict]:
    payload = run_helper("windows-local-web-search.py", [query[:500]], timeout=90)
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    cleaned = []
    for row in results[:6]:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "")[:1200]
        if not url.startswith(("http://", "https://")):
            continue
        cleaned.append(
            {
                "title": str(row.get("title") or url)[:240],
                "url": url,
                "snippet": str(row.get("snippet") or "")[:1200],
            }
        )
    return cleaned


def build_web_context(results: list[dict]) -> str:
    if not results:
        return ""
    lines = [
        "WEB SEARCH RESULTS:",
        "Use only these results for current web facts. Cite them inline as [1], [2], etc. "
        "Do not invent sources or claim a source says more than its snippet supports.",
    ]
    for index, row in enumerate(results, start=1):
        lines.append(
            f"[{index}] {row['title']}\\nURL: {row['url']}\\nSnippet: {row['snippet']}"
        )
    return "\\n\\n".join(lines)


def local_tts(text: str) -> bytes:
    text = text.strip()[:5000]
    if not text:
        raise RuntimeError("Nothing to speak.")
    with tempfile.TemporaryDirectory(prefix="coop-local-tts-") as temp:
        txt = Path(temp) / "speech.txt"
        wav = Path(temp) / "speech.wav"
        txt.write_text(text, encoding="utf-8")
        qtxt = str(txt).replace("'", "''")
        qwav = str(wav).replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Speech; "
            f"$t=[IO.File]::ReadAllText('{qtxt}'); "
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.SetOutputToWaveFile('{qwav}'); "
            "$s.Speak($t); $s.Dispose();"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=90,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0 or not wav.is_file():
            raise RuntimeError((result.stderr or "Windows speech synthesis failed.")[-600:])
        return wav.read_bytes()


class Handler(BaseHTTPRequestHandler):
    server_version = "CoOperativePersonalLocalAI/2.0"

    def log_message(self, *_args) -> None:
        return

    def _origin_ok(self) -> bool:
        return allowed_origin(self.headers.get("Origin"))

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self, maximum: int) -> bytes:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return b""
        if length > maximum:
            raise RuntimeError(f"Request is too large. Limit is {maximum // (1024 * 1024)} MB.")
        return self.rfile.read(length)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            body = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                "connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:;",
            )
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/hosted-history":
            conversation_id = (parse_qs(parsed.query).get("conversationId") or [None])[0]
            profile_token = self.headers.get("X-Cooperative-Profile-Token")
            try:
                self._json(
                    200,
                    hosted_history_request(
                        "GET",
                        conversation_id=conversation_id,
                        profile_token=profile_token,
                    ),
                )
            except Exception as exc:
                self._json(502, {"error": str(exc)[:800]})
            return

        if parsed.path == "/api/status":
            self._json(
                200,
                {
                    "localInference": True,
                    "ollamaReady": ollama_ready(),
                    "models": MODELS,
                    "features": {
                        "autoModel": True,
                        "images": True,
                        "imageGeneration": True,
                        "files": True,
                        "webSearch": True,
                        "voiceInput": True,
                        "voiceOutput": True,
                        "localHistory": True,
                        "projects": True,
                    },
                    "port": PORT,
                },
            )
            return

        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if not self._origin_ok():
            self._json(403, {"error": "Local request origin rejected."})
            return

        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/device-link-proof":
                self._json(201, device_link_proof())
                return

            if parsed.path == "/api/hosted-history":
                body = json.loads(self._read_body(512_000) or b"{}")
                profile_token = self.headers.get("X-Cooperative-Profile-Token")
                action = str(body.get("action") or "")
                if action == "create":
                    result = hosted_history_request(
                        "POST",
                        payload={
                            "action": "create",
                            "nodeId": NODE_ID,
                            "title": str(body.get("title") or "New chat")[:160],
                        },
                        profile_token=profile_token,
                    )
                elif action == "append":
                    conversation_id = str(body.get("conversationId") or "")
                    role = str(body.get("role") or "")
                    content = str(body.get("content") or "")
                    if not conversation_id or role not in {"user", "assistant"}:
                        raise RuntimeError("Invalid hosted history append request.")
                    result = hosted_history_request(
                        "POST",
                        payload={
                            "action": "append",
                            "nodeId": NODE_ID,
                            "conversationId": conversation_id,
                            "role": role,
                            "content": content[:200000],
                            "metadata": body.get("metadata")
                            if isinstance(body.get("metadata"), dict)
                            else {},
                        },
                        profile_token=profile_token,
                    )
                else:
                    raise RuntimeError("Unknown hosted history action.")
                self._json(200, result)
                return

            if parsed.path == "/api/extract":
                raw = self._read_body(MAX_FILE_BODY)
                name = (parse_qs(parsed.query).get("name") or ["upload.bin"])[0]
                safe_name = Path(name).name[:240] or "upload.bin"
                suffix = Path(safe_name).suffix
                with tempfile.NamedTemporaryFile(
                    prefix="coop-local-file-",
                    suffix=suffix,
                    delete=False,
                ) as temp:
                    temp.write(raw)
                    temp_path = Path(temp.name)
                try:
                    result = run_helper(
                        "windows-local-file-extract.py",
                        [str(temp_path)],
                        timeout=180,
                    )
                    self._json(
                        200,
                        {
                            "name": safe_name,
                            "kind": result.get("kind", "text"),
                            "text": str(result.get("text") or ""),
                            "characters": int(result.get("characters") or 0),
                            "localOnly": True,
                        },
                    )
                finally:
                    temp_path.unlink(missing_ok=True)
                return

            if parsed.path == "/api/voice/transcribe":
                raw = self._read_body(MAX_AUDIO_BODY)
                content_type = self.headers.get("Content-Type") or "audio/webm"
                suffix = ".wav" if "wav" in content_type else ".webm"
                with tempfile.NamedTemporaryFile(
                    prefix="coop-local-voice-",
                    suffix=suffix,
                    delete=False,
                ) as temp:
                    temp.write(raw)
                    temp_path = Path(temp.name)
                try:
                    result = run_helper(
                        "windows-local-voice.py",
                        [str(temp_path)],
                        timeout=600,
                    )
                    self._json(
                        200,
                        {
                            "text": str(result.get("text") or ""),
                            "model": result.get("model"),
                            "localOnly": True,
                        },
                    )
                finally:
                    temp_path.unlink(missing_ok=True)
                return

            if parsed.path == "/api/voice/speak":
                body = json.loads(self._read_body(128_000) or b"{}")
                audio = local_tts(str(body.get("text") or ""))
                self._bytes(200, audio, "audio/wav")
                return

            if parsed.path == "/api/chat":
                body = json.loads(self._read_body(MAX_JSON_BODY) or b"{}")
                messages = clean_messages(body.get("messages"))
                if not messages:
                    self._json(400, {"error": "A message is required."})
                    return

                images = clean_images(body.get("images"))
                project, project_chars = project_context(body.get("project"))
                query = latest_user_text(messages)

                if wants_image_generation(query):
                    BUSY_MARKER.write_text(str(os.getpid()), encoding="utf-8")
                    try:
                        generated = generate_local_image(query, images)
                    finally:
                        BUSY_MARKER.unlink(missing_ok=True)
                    self._json(
                        200,
                        {
                            "text": (
                                "Generated locally on this PC. "
                                f"Model: {generated.get('model') or 'local image model'}."
                            ),
                            "model": generated.get("model"),
                            "profile": generated.get("profile"),
                            "modelReason": "Local image-generation worker selected from the request.",
                            "localInference": True,
                            "imageGenerated": True,
                            "generatedImage": {
                                "dataUrl": generated.get("dataUrl"),
                                "model": generated.get("model"),
                                "profile": generated.get("profile"),
                                "seed": generated.get("seed"),
                                "latencyMs": generated.get("latencyMs"),
                                "prompt": query[:6000],
                            },
                            "webSearchUsed": False,
                            "webResults": [],
                        },
                    )
                    return

                web_mode = str(body.get("webMode") or "off").lower()
                should_search = web_mode == "always" or (
                    web_mode == "auto" and needs_web(query)
                )
                web_results = web_search(query) if should_search else []
                web_context = build_web_context(web_results)

                model_mode = str(body.get("modelMode") or "auto").lower()
                model, profile, model_reason = select_model(
                    model_mode,
                    messages,
                    image_count=len(images),
                    context_chars=project_chars,
                    web_used=bool(web_results),
                )

                system_parts = [
                    "You are CoOperativeLocalAI, a private general-purpose assistant "
                    "running on this Windows PC. Be useful, clear, practical, and honest. "
                    "Personal use has priority over contributed compute.",
                ]
                if project:
                    system_parts.append(
                        "The user has opened a local project workspace. Use the following local "
                        "project information when relevant, but do not pretend you changed files "
                        "or completed tasks unless the user actually confirms that happened.\\n\\n"
                        + project
                    )
                if web_context:
                    system_parts.append(web_context)

                ollama_messages = [{"role": "system", "content": "\\n\\n".join(system_parts)}]
                ollama_messages.extend(messages)
                if images:
                    if ollama_messages[-1]["role"] != "user":
                        ollama_messages.append(
                            {"role": "user", "content": "Analyze the attached image(s)."}
                        )
                    ollama_messages[-1]["images"] = images

                BUSY_MARKER.write_text(str(os.getpid()), encoding="utf-8")
                try:
                    ensure_model(model)
                    started = time.time()
                    response = httpx.post(
                        f"{OLLAMA_URL}/api/chat",
                        json={
                            "model": model,
                            "messages": ollama_messages,
                            "stream": False,
                            "options": {
                                "temperature": 0.3,
                                "num_predict": 1800 if profile == "heavy" else 1200,
                                "top_p": 0.9,
                            },
                        },
                        timeout=None,
                    )
                    response.raise_for_status()
                    result = response.json()
                    text = str((result.get("message") or {}).get("content") or "").strip()
                    if not text:
                        raise RuntimeError("The local model returned an empty response.")
                    output_tokens = int(result.get("eval_count") or 0)
                    eval_ns = int(result.get("eval_duration") or 0)
                    tokens_per_second = (
                        output_tokens / (eval_ns / 1_000_000_000)
                        if output_tokens > 0 and eval_ns > 0
                        else None
                    )
                    self._json(
                        200,
                        {
                            "text": text,
                            "model": model,
                            "profile": profile,
                            "modelReason": model_reason,
                            "latencyMs": int((time.time() - started) * 1000),
                            "tokensPerSecond": tokens_per_second,
                            "localInference": True,
                            "webSearchUsed": bool(web_results),
                            "webResults": [
                                {"title": row["title"], "url": row["url"]}
                                for row in web_results
                            ],
                        },
                    )
                finally:
                    BUSY_MARKER.unlink(missing_ok=True)
                return

            self._json(404, {"error": "Not found."})
        except Exception as exc:
            BUSY_MARKER.unlink(missing_ok=True)
            self._json(500, {"error": str(exc)[:900]})


def main() -> None:
    READY_MARKER.write_text(f"http://{HOST}:{PORT}", encoding="utf-8")
    print(f"UNISON_LOCAL_CHAT_READY http://{HOST}:{PORT}", flush=True)
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
        server.daemon_threads = True
        server.serve_forever()
    finally:
        for marker in (READY_MARKER, BUSY_MARKER):
            marker.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
