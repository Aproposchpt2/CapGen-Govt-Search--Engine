import { aproposLogoAttachment } from './lib/apropos-brand.mjs';

export default async function handler(req){
  if(req.method!=='GET'&&req.method!=='HEAD')return new Response('Method not allowed.',{status:405});
  const logo=Buffer.from(aproposLogoAttachment().content,'base64');
  return new Response(req.method==='HEAD'?null:logo,{status:200,headers:{'content-type':'image/jpeg','content-length':String(logo.length),'cache-control':'public, max-age=86400, immutable','x-content-type-options':'nosniff'}});
}
export const config={path:'/assets/apropos-group-logo.jpg'};
