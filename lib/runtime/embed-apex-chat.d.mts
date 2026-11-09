export type ApexEmbedProduct = {id:string;name:string;priceCents:number;currency:"USD";availability:"sold_out"|"in_stock";categoryName?:string|null};
export type ApexEmbedReply = {answer:string;items:{name:string;price:string;availability:string;href:string}[];link?:string};
export declare function answerApexEmbed(message:string,products?:ApexEmbedProduct[],catalogState?:string):ApexEmbedReply;

export declare function validateApexEmbedInput(value:unknown):{version:1;message:string;catalogState:string;products:ApexEmbedProduct[]}|null;
