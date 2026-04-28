const express = require('express');
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const RESEND_API_KEY  = process.env.RESEND_API_KEY  || '';
const SUPABASE_URL    = process.env.SUPABASE_URL    || '';
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || '';
const STRIPE_SECRET   = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE    = process.env.STRIPE_PRICE_ID   || '';
const STRIPE_WEBHOOK  = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL         = process.env.APP_URL || 'https://www.beatlicense.com.br';

app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const TIERS=[{min:0,max:99,rate:0.05,label:'5%'},{min:100,max:499,rate:0.07,label:'7%'},{min:500,max:999,rate:0.09,label:'9%'},{min:1000,max:null,rate:0.11,label:'11%'}];
function getTier(v){return TIERS.find(t=>v>=t.min&&(t.max===null||v<=t.max));}
function fmtBRL(n){return 'R$ '+n.toFixed(2).replace('.',',');}
function fmtDate(d){return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});}
const LIC={
  basic:{title:'LICENÇA BÁSICA NÃO-EXCLUSIVA',limits:'Distribuição limitada a 50.000 streams. Proibido publicidade paga.'},
  premium:{title:'LICENÇA PREMIUM NÃO-EXCLUSIVA',limits:'Distribuição limitada a 500.000 streams. Redes sociais liberadas.'},
  exclusive:{title:'LICENÇA EXCLUSIVA COM TRANSFERÊNCIA DE DIREITOS',limits:'Uso ilimitado em todos os territórios'}
};

// ── Gera PDF em buffer ───────────────────────────────────────────────────────
function gerarPDFBuffer(d){
  return new Promise((resolve,reject)=>{
    const tier=getTier(d.price),fee=d.price*tier.rate,net=d.price-fee;
    const docId='BL-'+new Date().getFullYear()+'-'+uuidv4().slice(0,8).toUpperCase();
    const info=LIC[d.licenseType];
    const doc=new PDFKit({size:'A4',margins:{top:60,bottom:60,left:70,right:70}});
    const chunks=[];
    doc.on('data',c=>chunks.push(c));
    doc.on('end',()=>resolve({buffer:Buffer.concat(chunks),docId}));
    doc.on('error',reject);
    const C={purple:'#534AB7',dark:'#1A1A1A',muted:'#666',line:'#E0DED6',bg:'#F7F6F2'};
    const pw=doc.page.width-140,ml=70;
    doc.rect(0,0,doc.page.width,80).fill(C.purple);
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('BeatLicense',ml,24);
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(10).font('Helvetica').text('Licenciamento Digital Profissional',ml+2,50);
    let y=100;
    doc.fillColor(C.muted).fontSize(9).text('Documento '+docId+' | '+fmtDate(new Date()),ml,y,{align:'center',width:pw});y+=22;
    doc.moveTo(ml,y+40).lineTo(ml+pw,y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.producerName,ml,y+46,{width:sw,align:'center'});
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.buyerName,ml+sw+40,y+46,{width:sw,align:'center'});
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE',ml,y+60,{width:sw,align:'center'});
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO',ml+sw+40,y+60,{width:sw,align:'center'});
    doc.end();
  });
}

// Versão corrigida da gerarPDFBuffer com sw definido
function gerarPDFBufferV2(d){
  return new Promise((resolve,reject)=>{
    const tier=getTier(d.price),fee=d.price*tier.rate,net=d.price-fee;
    const docId='BL-'+new Date().getFullYear()+'-'+uuidv4().slice(0,8).toUpperCase();
    const info=LIC[d.licenseType];
    const doc=new PDFKit({size:'A4',margins:{top:60,bottom:60,left:70,right:70}});
    const chunks=[];
    doc.on('data',c=>chunks.push(c));
    doc.on('end',()=>resolve({buffer:Buffer.concat(chunks),docId}));
    doc.on('error',reject);
    const C={purple:'#534AB7',dark:'#1A1A1A',muted:'#666',line:'#E0DED6',bg:'#F7F6F2'};
    const pw=doc.page.width-140,ml=70;
    const sw=(pw/2)-20;
    doc.rect(0,0,doc.page.width,80).fill(C.purple);
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('BeatLicense',ml,24);
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(10).font('Helvetica').text('Licenciamento Digital Profissional',ml+2,50);
    let y=100;
    doc.fillColor(C.muted).fontSize(9).text('Documento '+docId+' | '+fmtDate(new Date()),ml,y,{align:'center',width:pw});y+=22;
    // Título
    doc.rect(ml,y+10,pw,36).fill(C.purple);
    doc.fillColor('#fff').fontSize(13).font('Helvetica-Bold').text(info.title,ml,y+20,{align:'center',width:pw});y+=60;
    // Beat info
    doc.fillColor(C.dark).fontSize(11).font('Helvetica-Bold').text('BEAT: '+d.beatName.toUpperCase(),ml,y);y+=18;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('Produzido por '+d.producerName,ml,y);y+=28;
    // Valores
    doc.rect(ml,y,pw,70).fill(C.bg);
    doc.fillColor(C.muted).fontSize(9).text('Valor da venda',ml+12,y+10);
    doc.fillColor(C.dark).fontSize(14).font('Helvetica-Bold').text(fmtBRL(d.price),ml+12,y+22);
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('Royalty ('+tier.label+')',ml+120,y+10);
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text(fmtBRL(fee),ml+120,y+22);
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('Valor líquido',ml+240,y+10);
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text(fmtBRL(net),ml+240,y+22);
    y+=80;
    // Termos
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text('TERMOS DA LICENÇA',ml,y);y+=14;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text(info.limits,ml,y,{width:pw});y+=30;
    doc.fillColor(C.muted).fontSize(8).text('O licenciado ('+d.buyerName+', CPF: '+d.buyerCpf+') adquire os direitos de uso do beat conforme os termos acima. A presente licença é válida a partir de '+fmtDate(new Date())+'.',ml,y,{width:pw});y+=40;
    // Assinaturas
    doc.moveTo(ml,y).lineTo(ml+sw,y).strokeColor(C.line).lineWidth(1).stroke();
    doc.moveTo(ml+sw+40,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(1).stroke();y+=8;
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.producerName,ml,y,{width:sw,align:'center'});
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.buyerName,ml+sw+40,y,{width:sw,align:'center'});y+=14;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE',ml,y,{width:sw,align:'center'});
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO — '+d.buyerEmail,ml+sw+40,y,{width:sw,align:'center'});
    doc.end();
  });
}

// ── Envia email via Resend ───────────────────────────────────────────────────
function httpsReq(opts,body){
  return new Promise((resolve,reject)=>{
    const payload=body||'';
    if(payload)opts.headers['Content-Length']=Buffer.byteLength(payload);
    const req=https.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,body:d})}});});
    req.on('error',reject);
    if(payload)req.write(payload);req.end();
  });
}

async function enviarEmailResend({to,toName,producerName,beatName,docId,pdfBuffer}){
  const pdfB64=pdfBuffer.toString('base64');
  const html=`
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
      <div style="background:#534AB7;padding:24px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">BeatLicense 🎵</h1>
        <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">Licença Digital Profissional</p>
      </div>
      <div style="background:#f9f9f9;padding:28px;border-radius:0 0 8px 8px;border:1px solid #e8e8e8;">
        <p style="font-size:15px;color:#1d1d1f;">Olá, <strong>${toName}</strong>!</p>
        <p style="color:#555;font-size:14px;">Sua licença para o beat <strong>"${beatName}"</strong> produzido por <strong>${producerName}</strong> está pronta!</p>
        <p style="color:#555;font-size:14px;">O PDF da licença está em anexo neste email. Documento: <strong>${docId}</strong></p>
        <div style="background:white;border:1px solid #e0e0e0;border-radius:6px;padding:16px;margin:20px 0;">
          <p style="color:#534AB7;font-weight:bold;margin:0 0 6px;">📄 Licença em anexo</p>
          <p style="color:#888;font-size:12px;margin:0;">Guarde este documento — ele é sua comprovação legal de uso do beat.</p>
        </div>
        <p style="color:#aaa;font-size:11px;margin-top:24px;">BeatLicense • beatlicense.com.br</p>
      </div>
    </div>
  `;
  const body=JSON.stringify({
    from:'BeatLicense <onboarding@resend.dev>',
    to:[to],
    subject:'🎵 Sua licença do beat "'+beatName+'" está pronta!',
    html,
    attachments:[{filename:docId+'.pdf',content:pdfB64}]
  });
  const resp=await httpsReq({
    hostname:'api.resend.com',
    path:'/emails',
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+RESEND_API_KEY}
  },body);
  console.log('Resend status:',resp.status,'body:',JSON.stringify(resp.body).slice(0,200));
  return resp;
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function salvarLicencaDB(d){
  if(!SUPABASE_URL||!SUPABASE_KEY)return null;
  const body=JSON.stringify({produtor_email:d.producerName||'desconhecido',beat_name:d.beatName,buyer_name:d.buyerName,buyer_cpf:d.buyerCpf,buyer_email:d.buyerEmail,license_type:d.licenseType,price:d.price,doc_id:d.docId||null});
  return httpsReq({hostname:new URL(SUPABASE_URL).hostname,path:'/rest/v1/licencas',method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=minimal'}},body);
}

// ── Stripe helpers ───────────────────────────────────────────────────────────
function stripePost(path,fields){
  const payload=Object.keys(fields).map(k=>k+'='+encodeURIComponent(fields[k])).join('&');
  return httpsReq({hostname:'api.stripe.com',path,method:'POST',headers:{'Authorization':'Bearer '+STRIPE_SECRET,'Content-Type':'application/x-www-form-urlencoded'}},payload);
}
function verifyStripe(rawBody,sig,secret){
  try{
    const parts=sig.split(',').reduce((a,p)=>{const[k,v]=p.split('=');a[k]=v;return a},{});
    const expected=crypto.createHmac('sha256',secret).update(parts.t+'.'+rawBody,'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(parts.v1));
  }catch(e){return false;}
}

// ── Rotas ────────────────────────────────────────────────────────────────────
app.get('/ping',(_,res)=>res.json({status:'ok',message:'BeatLicense v8 - Resend email integrado!'}));

app.post('/criar-assinatura',async(req,res)=>{
  const{email,name}=req.body;
  if(!email)return res.status(400).json({erro:'Email obrigatório'});
  try{
    const session=await stripePost('/v1/checkout/sessions',{
      'payment_method_types[]':'card',
      'line_items[0][price]':STRIPE_PRICE,
      'line_items[0][quantity]':'1',
      mode:'subscription',
      success_url:APP_URL+'/painel?assinatura=ativa',
      cancel_url:APP_URL+'/?cancelado=1',
      customer_email:email,
      'metadata[name]':name||''
    });
    if(!session.body.url)return res.status(500).json({erro:'Erro ao criar sessão'});
    res.json({url:session.body.url});
  }catch(err){res.status(500).json({erro:err.message});}
});

app.post('/webhook/stripe',async(req,res)=>{
  const sig=req.headers['stripe-signature'];
  if(!verifyStripe(req.body,sig,STRIPE_WEBHOOK))return res.status(400).json({erro:'Assinatura inválida'});
  res.json({ok:true});
  try{
    const evt=JSON.parse(req.body.toString());
    if(evt.type==='checkout.session.completed'){
      const s=evt.data.object;
      if(SUPABASE_URL&&SUPABASE_KEY&&s.customer_email){
        httpsReq({hostname:new URL(SUPABASE_URL).hostname,path:'/rest/v1/produtores',method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'resolution=merge-duplicates,return=minimal'}},
          JSON.stringify({email:s.customer_email,nome:(s.metadata&&s.metadata.name)||'',plano:'pro',ativo:true,stripe_session:s.id})
        ).catch(e=>console.error('Supabase:',e.message));
      }
    }
    if(evt.type==='customer.subscription.deleted'){console.log('Assinatura cancelada:',evt.data.object.customer);}
  }catch(e){console.error('Webhook Stripe:',e.message);}
});

app.post('/gerar-licenca',async(req,res)=>{
  const{buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType,price:priceRaw}=req.body;
  for(const[f,v]of Object.entries({buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType})){if(!v||!String(v).trim())return res.status(400).json({erro:'Campo ausente: '+f});}
  const price=parseFloat(priceRaw);
  if(isNaN(price)||price<=0)return res.status(400).json({erro:'Valor inválido.'});
  if(!LIC[licenseType])return res.status(400).json({erro:'Tipo inválido.'});
  try{
    const{buffer,docId}=await gerarPDFBufferV2({buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType,price});
    console.log('PDF gerado:',docId,'para',buyerEmail);
    // Envia email com PDF em anexo via Resend
    if(RESEND_API_KEY){
      const emailResp=await enviarEmailResend({to:buyerEmail,toName:buyerName,producerName,beatName,docId,pdfBuffer:buffer});
      console.log('Email enviado:',emailResp.status);
    }
    // Salva no Supabase
    await salvarLicencaDB({buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType,price,docId});
    res.json({sucesso:true,mensagem:'Licença enviada para '+buyerEmail+'!',docId});
  }catch(err){
    console.error('Erro gerar-licenca:',err.message);
    res.status(500).json({erro:err.message});
  }
});

app.listen(PORT,()=>console.log('BeatLicense porta',PORT));
