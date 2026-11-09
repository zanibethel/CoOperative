import {answerApexKnowledge,APEX_FAQ_IDS} from "../lib/runtime/embed-apex-knowledge.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {answerApexEmbed,validateApexEmbedInput} from "../lib/runtime/embed-apex-chat.mjs";
const id="e18368cf-0adb-432c-8dfc-4cb6e9b47ed7";
const product={id,name:"Example Item",priceCents:1234,currency:"USD",availability:"sold_out",categoryName:"Samples"};
test("only approved current catalog items are returned",()=>{
 const r=answerApexEmbed("price Example Item",[product,{...product,id:"bad",name:"private"}],"connected");
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].price,"$12.34");
 assert.equal(r.items[0].href,"/catalog/product/"+id);
});
test("fail-closed on disabled catalog, no private leakage",()=>{
 const r=answerApexEmbed("Example Item",[product],"disabled");
 assert.equal(r.items.length,0);
 assert.match(r.answer,/not available/i);
});
test("does not create, publish, sell, or give dosing advice",()=>{
 for(const q of ["create a product","publish product","buy now","what dose should I take?"]){
  const r=answerApexEmbed(q,[product],"connected");
  assert.equal(r.items.length,0,q);
 }
});
test("unknown names don't hallucinate products",()=>{
 const r=answerApexEmbed("Find fictional-widget-name",[product],"connected");
 assert.equal(r.items.length,0);
});
test("invalid product payload is ignored",()=>{
 const r=answerApexEmbed("products",[{...product,priceCents:-1}],"connected");
 assert.equal(r.items.length,0);
});

test("strictly allows only approved public item fields and no private payload",()=>{
 const base={version:1,message:"show Example",catalogState:"connected",products:[product]};
 assert.equal(validateApexEmbedInput(base)?.products[0].name,"Example Item");
 assert.equal(validateApexEmbedInput({...base,userId:"private"}),null);
 assert.equal(validateApexEmbedInput({...base,products:[{...product,internal_source_cost_cents:42}]}),null);
 assert.equal(validateApexEmbedInput({...base,products:[{...product,priceCents:-1}]}),null);
 assert.equal(validateApexEmbedInput({...base,catalogState:"disabled"}),null);
 assert.equal(validateApexEmbedInput({...base,products:[],catalogState:"disabled"})?.catalogState,"disabled");
});


test("versioned no-model FAQ routes cover core customer and supplier intents",()=>{
 const cases=[["hello","greeting"],["help","chat-capabilities"],["what can you do","chat-capabilities"],["are you an AI bot","assistant-identity"],["powered by cooperative chat","assistant-identity"],["forgot password","account-password"],["I want to sign in","account"],["supplier login","supplier-access"],["create product","catalog-mutations"],["track inventory","supplier-inventory"],["supplier csv order report","supplier-reports"],["is shipping available","shipping"],["what is free shipping","shipping"],["can I return an item","returns"],["where is my order","track-order"],["how to pay with Bitcoin","payments"],["when will Apex launch","launch"],["do you have a coupon code","discounts"],["my data privacy","privacy"],["is this safe for me to take","medical"],["what are side effects","medical"],["recommend a product for weight loss","product-usage"],["when will the product restock","public-stock"],["how do sales tax work","pricing-policy"],["what are your opening hours","where-to-buy"],["contact support","support"],["how do I browse products","public-products"]];
 assert.ok(APEX_FAQ_IDS.length>=22);
 for(const [prompt,expected] of cases){
  const result=answerApexKnowledge(prompt);
  assert.equal(result?.intent,expected,prompt);
  assert.equal(result.items.length,0,prompt);
  assert.equal(answerApexEmbed(prompt,[product],"disabled").items.length,0,prompt);
 }
 for(const prompt of ["show me products","what is the price of Example Item","purple mystery widget"]){
  assert.equal(answerApexKnowledge(prompt),null,prompt);
 }
 assert.equal(answerApexEmbed("show me products",[product],"connected").items.length,1);
 assert.equal(answerApexEmbed("what is the price of Example Item",[product],"connected").items[0].price,"$12.34");
});
