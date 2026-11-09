import test from "node:test";
import assert from "node:assert/strict";
import {answerApexEmbed} from "../lib/runtime/embed-apex-chat.mjs";
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
