// Apex/CoOperative shared deterministic FAQ rules. Safe public information only.
// Keep this file identical in Apex and CoOperative. Do not claim unreleased
// commerce features, unverified policies, medical outcomes, or personal support.
const answer=(intent,answer,link)=>({intent,answer,items:[],...(link?{link}:{})});
const rules=[
 {id:"medical",p:/\b(dos(?:e|age|ing)|inject(?:ion|ing|able)?|cycle|stack(?:ing)?|pinn?ing|prescrib(?:e|ed|ing)|diagnos(?:e|is|ing)|treat(?:ment|ing)?|side effects?|adverse effects?|therap(?:y|eutic)|how (?:do i|to) use|is (?:it|this|that|.+) safe (?:for|to use)|should i take|what (?:does|will) .+ do to (?:my|the) body|medic(?:al|ine)|fertility|hormone levels?|lab results?)\b/i,
  a:"I can help with publicly approved product names, listed prices and availability, but not dosing, administration, health effects, treatment, or personalized product-use advice. Please consult a qualified clinician."},
 {id:"catalog-mutations",p:/\b(create|add|edit|update|publish|unpublish|delete|remove|change|upload|import|export|set)\b.{0,75}\b(product|products|listing|listings|price|prices|inventory|stock|sku|photo|image|catalog)\b|\b(product|products|listing|listings|price|inventory|stock)\b.{0,75}\b(create|add|edit|update|publish|unpublish|delete|remove|change|upload|import|export)\b/i,
  a:"Only signed-in, authorized suppliers can manage their own products in the Supplier workspace. The chat can explain that process, but does not create, edit, import, or publish listings.",l:"/supplier"},
 {id:"supplier-access",p:/\b(supplier|vendor|seller|booth|store owner|store manager)\b.{0,70}\b(login|log in|sign in|dashboard|portal|access|account|products|workspace|manage)\b|\b(login|log in|sign in|dashboard|portal|workspace)\b.{0,70}\b(supplier|vendor|seller)\b/i,
  a:"Suppliers can open their protected workspace to manage permitted products, imports and operational records. Access depends on a verified supplier account and assigned permissions.",l:"/supplier"},
 {id:"supplier-inventory",p:/\b(inventory tracking|track inventory|unlimited stock|stock tracking|don't track quantities|dont track quantities|no stock tracking)\b/i,
  a:"Inventory preferences are managed by the authorized supplier in the Supplier workspace. Turning off quantity display or tracking preferences does not guarantee availability or bypass checkout and public-release restrictions.",l:"/supplier"},
 {id:"supplier-reports",p:/\b(supplier|vendor|seller|daily report|sales report|csv|fulfill(?:ment)?|tracking number|shipping label|usps)\b.{0,70}\b(report|csv|fulfill(?:ment)?|ship(?:ping|ped)?|order|tracking|labels?|usps|download|upload)\b/i,
  a:"Authorized suppliers can review available order, reporting, CSV and shipping tools in their protected workspace. This public chat cannot access private sales, customer addresses, tracking records or shipment states.",l:"/supplier"},
 {id:"assistant-identity",p:/\b(are you (?:an? )?(?:ai|bot|human|robot|person)|chatgpt|human agent|who am i talking to|how does (?:this|the) chat work|powered by|cooperative chat)\b/i,
  a:"I'm the Apex site assistant, powered by CoOperative's code-first chat logic. Routine questions use programmed answers and approved public catalog data rather than paid AI generation. I can't access private accounts or place orders."},
 {id:"chat-capabilities",p:/^(?:help(?: me)?|menu|options)[.!?\s]*$|\b(what can you do|how can you help|what (?:questions|can) (?:i|we) ask|what do you know)\b/i,
  a:"Ask me about public products, listed prices, availability, account access, supplier navigation, checkout readiness, shipping, discounts or site policies. I use verified public information only and cannot make account changes or process orders.",l:"/catalog"},
 {id:"greeting",p:/^(?:hi|hello|hey|good morning|good afternoon|good evening|yo|howdy|thanks|thank you|thx)[.!?\s]*$/i,
  a:"Hi! I can help with public Apex products and prices, site navigation, account access and current ordering availability. What would you like to know?",l:"/catalog"},
 {id:"account-password",p:/\b(forgot|reset|recover|lost|change)\b.{0,30}\b(password|login|account access)\b|\b(password)\b.{0,30}\b(reset|forgot|recover|lost)\b/i,
  a:"Start at Account sign in and use the available account recovery options. This assistant cannot see, reset or request your password. Never send passwords or verification codes in chat.",l:"/account/sign-in"},
 {id:"account",p:/\b(sign ?up|register|create (?:an? )?account|customer login|account login|log ?in|sign ?in|my profile|update (?:my )?address|account details)\b/i,
  a:"Use the Account sign-in page for customer access. The assistant cannot inspect or change your profile, email, password or shipping information.",l:"/account/sign-in"},
 {id:"privacy",p:/\b(privacy|personal data|my data|save (?:my )?chat|chat history|track(?:ing)? me|private information|security|scam|credentials?|credit card details?|passwords?|verification code)\b/i,
  a:"This text assistant only needs your question and approved public catalog details. Do not share passwords, verification codes, card details, wallet secrets or personal addresses. This version does not provide private account lookup or chat-based purchases."},
 {id:"discounts",p:/\b(coupons?|promo(?:tional)? codes?|discounts?|on sale|sale price|special offers?|deals?|free shipping code|gift cards?|loyalty|rewards?)\b/i,
  a:"I can't verify an active discount, coupon, gift-card program or promotion from this chat. Offers and any shipping incentives must appear in published store terms when checkout is enabled. Checkout is currently unavailable.",l:"/catalog"},
 {id:"shipping",p:/\b(shipping|ship(?:ped|ment)?|delivery|postage|usps|freight|shipping fees?|shipping costs?|free shipping|overnight|express|international shipping|deliver by|shipping times?|shipping rates?)\b/i,
  a:"Ordering and shipping are currently unavailable, so I can't quote a live delivery date, rate, eligibility threshold or destination. Published checkout policies will control any future shipping fees.",l:"/catalog"},
 {id:"returns",p:/\b(refunds?|returns?|exchanges?|cancellations?|cancel (?:an? )?order|chargebacks?|damaged (?:item|package)|lost package|missing package)\b/i,
  a:"This assistant cannot approve cancellations, refunds, returns or exchanges. I can't verify a live refund or return policy while checkout is unavailable. Use your existing authorized support channel for any real past transaction."},
 {id:"track-order",p:/\b(track (?:my |an? )?order|where is my order|order status|order history|receipt|invoice|confirmation email|my purchase|my shipment|tracking number)\b/i,
  a:"I can't retrieve private orders, receipts, tracking numbers or purchase history. Checkout is currently unavailable and the chat cannot create or confirm a purchase. Suppliers should use their authorized Orders workspace.",l:"/supplier"},
 {id:"payments",p:/\b(payment|pay(?:ing)?|checkout|buy|purchase|bitcoin|crypto(?:currency)?|btcpay|card payment|paypal|apple pay|google pay|venmo|cash app|wallet address|split payment|payout|how to order)\b/i,
  a:"Apex checkout is currently unavailable; no order or payment can be placed through this assistant. Bitcoin payment infrastructure is being developed, but a live payment method or invoice is not available here.",l:"/catalog"},
 {id:"public-stock",p:/\b(why (?:is|are) .+ sold out|out of stock|back in stock|restock|preorder|pre-order|backorder|stock alert|inventory alert)\b/i,
  a:"Availability is determined only by publicly approved catalog entries. I can't predict restock dates, reserve inventory or create alerts. Supplier drafts are not public listings.",l:"/catalog"},
 {id:"product-usage",p:/\b(best product|recommend(?:ation)?s?|what should i (?:use|take|buy)|for (?:my |me )?(?:muscle|weight loss|fat loss|performance|healing)|product benefits?|is it effective|does it work|results? should i expect)\b/i,
  a:"I can compare publicly listed product names, prices, categories and availability, but cannot recommend a product for personal use or promise health, fitness or treatment outcomes. You can browse the approved catalog.",l:"/catalog"},
 {id:"pricing-policy",p:/\b(are prices? (?:accurate|final|current)|price match|why is (?:it|this|the) price|compare.at price|compare price|wholesale price|bulk price|price guarantee|taxes?|sales tax|customs fees?)\b/i,
  a:"I can repeat prices shown in the approved public catalog, but can't promise a final total, wholesale price, tax treatment, discount, or future checkout terms. Checkout remains unavailable.",l:"/catalog"},
 {id:"public-products",p:/\b(where (?:can|do) i (?:browse|see|find) (?:the |your )?(?:catalog|products)|how (?:do i|to) browse (?:the |your )?(?:catalog|products)|where is (?:the |your )?catalog)\b/i,
  a:"Browse the publicly approved catalog for currently visible names, categories, prices and availability. Draft or unreleased supplier products are not shown.",l:"/catalog"},
 {id:"where-to-buy",p:/\b(physical store|store location|address|visit (?:the )?store|pickup|local pickup|opening hours|business hours|open today|where (?:are you|is apex) located)\b/i,
  a:"I don't have verified public pickup, store-location or business-hour information. Please don't rely on this chat for an address or in-person availability. The online catalog is available to browse.",l:"/catalog"},
 {id:"support",p:/\b(contact|customer service|support (?:team|person|email)|human|real person|phone number|email address|complaint|speak to someone|talk to someone)\b/i,
  a:"I can't verify a public support email or phone number from the approved information available to chat. For account or supplier assistance, use your existing authorized communication channel. Do not send personal data in this public chat.",l:"/account/sign-in"},
 {id:"launch",p:/\b(when (?:will|are) (?:you|apex) launch|when can i order|go live|launch date|coming soon|available to buy|will checkout open)\b/i,
  a:"There is no confirmed public checkout launch date I can verify. You may browse the approved catalog, but orders and payments remain disabled.",l:"/catalog"},
];
export const APEX_FAQ_IDS=Object.freeze(rules.map(x=>x.id));
export function answerApexKnowledge(message){
 if(typeof message!=="string"||!message.trim()||message.length>300)return null;
 const q=message.trim().toLowerCase().replace(/\s+/g," ");
 const match=rules.find(x=>x.p.test(q));
 return match?answer(match.id,match.a,match.l):null;
}
