// CoOperative's zero-model, read-only Apex storefront assistant.
// Accept ONLY the public Apex catalog projection. No writes, private context, or AI providers.
const SAFE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const common=new Set(["what","are","is","the","a","an","of","for","me","your","you","do","have","show","find","can","i","please","tell","about","price","prices","cost","costs","much","how","product","products","item","items","available","availability","stock","in","on","and","with","from","apex","catalog","list","looking"]);
const money=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
function validItems(items){
 if(!Array.isArray(items))return [];
 return items.filter(x=>x&&typeof x==="object"&&SAFE_UUID.test(x.id)&&typeof x.name==="string"&&x.name.length>0&&x.name.length<=120&&Number.isSafeInteger(x.priceCents)&&x.priceCents>0&&x.priceCents<=999999999&&x.currency==="USD"&&["sold_out","in_stock"].includes(x.availability)).slice(0,72);
}
export function answerApexEmbed(message,products=[],catalogState="unavailable"){
 if(typeof message!=="string"||!message.trim()||message.length>300)return {answer:"Please send a short text question.",items:[]};
 const q=message.toLowerCase().trim().replace(/\s+/g," ");
 if(/\b(dosage|dose|cycle|inject|injection|prescribe|treat|diagnos|stack|pinn?ing)\b/.test(q))return {answer:"I can share approved catalog details and site policies, but not medical or dosing advice. Please consult a qualified clinician.",items:[]};
 if(/\b(create|add|edit|update|publish|delete|remove|change)\b/.test(q)&&/\b(product|products|listing|listings|price|inventory|stock)\b/.test(q))
  return {answer:"Chat-based catalog changes aren't available yet. Suppliers can use the authorized Products workspace for their own listings. This assistant never edits or publishes anything.",items:[],link:"/supplier"};
 if(/\b(checkout|order|purchase|pay|payment|bitcoin|buy)\b/.test(q))
  return {answer:"Apex checkout and payments are currently unavailable. This assistant can't take orders, process payments, or confirm shipments.",items:[],link:"/catalog"};
 if(/\b(shipping|ship|delivery|refund|return)\b/.test(q))
  return {answer:"Shipping and refund details depend on published store policies and actual checkout readiness. Checkout is currently unavailable, so I can't confirm a shipping charge or delivery date.",items:[],link:"/catalog"};
 if(/^(hi|hello|hey|help|thanks|thank you)[!. ]*$/.test(q))
  return {answer:"Hi! I can help you browse publicly approved Apex listings and their current listed prices, or answer basic site questions. I can't place orders or change listings.",items:[],link:"/catalog"};
 if(/\b(suggest|recommend|best|for me|should i use)\b/.test(q))
  return {answer:"I can help you compare published product names, prices, and listed availability, but I don't make personalized product-use recommendations. What product name or category would you like to look up?",items:[],link:"/catalog"};
 if(catalogState!=="connected")
  return {answer:"The approved public product catalog is not available right now. I can't verify live listings or prices. Please check the catalog page.",items:[],link:"/catalog"};
 const items=validItems(products);
 if(items.length===0)return {answer:"There are no publicly approved listings available for me to show right now. Supplier drafts and unreleased items are private.",items:[],link:"/catalog"};
 const normalized=q.replace(/[^a-z0-9 -]/g," ");
 const words=normalized.split(/\s+/).filter(w=>w.length>1&&!common.has(w));
 const matching=words.length ? items.filter(x=>{
  const name=x.name.toLowerCase();
  const category=(typeof x.categoryName==="string"?x.categoryName:"").toLowerCase();
  return words.every(w=>name.includes(w)||category.includes(w));
 }) : items;
 if(matching.length===0)return {answer:"I couldn't find a matching item in the currently loaded public catalog. Try a shorter product name or browse the full catalog.",items:[],link:"/catalog"};
 const visible=matching.slice(0,4).map(x=>({
  name:x.name,price:money(x.priceCents),
  availability:x.availability==="in_stock"?"In stock (checkout unavailable)":"Currently unavailable",
  href:"/catalog/product/"+x.id
 }));
 return {answer:words.length?"Here are matching publicly approved listings. Listed prices and stock status come from Apex's approved catalog:":"Here are a few publicly approved listings. For more options, browse the catalog:",items:visible,link:"/catalog"};
}
