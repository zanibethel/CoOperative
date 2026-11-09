import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {answerApexEmbed} from "@/lib/runtime/embed-apex-chat.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";
// No model/provider calls or billing; this endpoint executes deterministic code only.
const headers={"Cache-Control":"no-store","Content-Type":"application/json"};
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

export async function POST(request:NextRequest){
 const secret=process.env.COOPERATIVE_APEX_EMBED_TOKEN;
 if(!secret||secret.length<32)return respond({error:"Not configured"},503);
 const supplied=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]??"";
 const expectedBytes=Buffer.from(secret,"utf8");
 const suppliedBytes=Buffer.from(supplied,"utf8");
 if(suppliedBytes.length!==expectedBytes.length||!timingSafeEqual(suppliedBytes,expectedBytes))
  return respond({error:"Unauthorized"},401);
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
  return respond({error:"JSON required"},415);
 if(Number(request.headers.get("content-length")??0)>55000)
  return respond({error:"Request too large"},413);
 let body:unknown;
 try{
  const raw=await request.text();
  if(raw.length>55000)return respond({error:"Request too large"},413);
  body=JSON.parse(raw);
 }catch{return respond({error:"Invalid request"},400);}
 if(!body||typeof body!=="object"||Array.isArray(body))
  return respond({error:"Invalid request"},400);
 const payload=body as Record<string,unknown>;
 if(payload.version!==1||typeof payload.message!=="string"||payload.message.length>300||
    !Array.isArray(payload.products)||payload.products.length>72||
    !["connected","disabled","unconfigured","unavailable"].includes(String(payload.catalogState)))
  return respond({error:"Invalid request"},400);
 const reply=answerApexEmbed(payload.message,payload.products,payload.catalogState as string);
 return respond({...reply,source:"cooperative-code-v1"});
}
export async function GET(){return respond({error:"Method not allowed"},405);}
