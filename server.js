const express = require('express');
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;
const CLICKSIGN_TOKEN  = process.env.CLICKSIGN_TOKEN  || '';
const SUPABASE_URL     = process.env.SUPABASE_URL     || '';
const SUPABASE_KEY     = process.env.SUPABASE_KEY     || '';
const STRIPE_SECRET    = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE     = process.env.STRIPE_PRICE_ID  || '';
const APP_URL          = process.env.APP_URL           || 'https://beatlicense-app.vercel.app';

app.use(express.json({ limit: '10mb' }));
app.use(cors());

const TIERS = [
  { min:0,    max:99,   rate:0.05, label:'5%'  },
  { min:100,  max:499,  rate:0.07, label:'7%'  },
  { min:500,  max:999,  rate:0.09, label:'9%'  },
  { min:1000, max:null, rate:0.11, label:'11%' },
];
function getTier(v) { return TIERS.find(t => v>=t.min && (t.max===null||v<=t.max)); }
function fmtBRL(n) { return 'R$ '+n.toFixed(2).replace('.',','); }
function fmtDate(d) { return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}); }

const LIC = {
  basic:     { title:'LICENCA BASICA NAO-EXCLUSIVA',                    limits:'Distribuicao limitada a 50.000 streams. Proibido publicidade paga.' },
  premium:   { title:'LICENCA PREMIUM NAO-EXCLUSIVA',                   limits:'Distribuicao limitada a 500.000 streams. Redes sociais liberadas. Proibido publicidade paga.' },
  exclusive: { title:'LICENCA EXCLUSIVA COM TRANSFERENCIA DE DIREITOS', limits:'Uso ilimitado em todos os territorios. Inclui sincronizacao e publicidade comercial.' }
};

function gerarPDFBuffer(d) {
  return new Promise((resolve, reject) => {
    const tier=getTier(d.price), fee=d.price*tier.rate, net=d.price-fee;
    const docId='BL-'+new Date().getFullYear()+'-'+uuidv4().slice(0,8).toUpperCase();
    const info=LIC[d.licenseType];
    const doc=new PDFKit({size:'A4',margins:{top:60,bottom:60,left:70,right:70}});
    const chunks=[];
    doc.on('data',c=>chunks.push(c));
    doc.on('end',()=>resolve({buffer:Buffer.concat(chunks),docId}));
    doc.on('error',reject);
    const C={purple:'#534AB7',dark:'#1A1A1A',muted:'#666',line:'#E0DED6',bg:'#F7F6F2'};
    const pw=doc.page.width-140, ml=70;
    doc.rect(0,0,doc.page.width,80).fill(C.purple);
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('BeatLicense',ml,24);
    doc.fillColor('#CECBF6').fontSize(9).font('Helvetica').text('Licenciamento musical automatizado',ml,50);
    doc.fillColor('#fff').fontSize(9).text(docId,0,30,{align:'right',width:doc.page.width-70});
    let y=110;
    doc.fillColor(C.purple).fontSize(13).font('Helvetica-Bold').text(info.title,ml,y,{align:'center',width:pw});
    y+=28;
    doc.moveTo(ml,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(0.5).stroke(); y+=12;
    doc.rect(ml,y,pw,105).fill(C.bg); y+=10;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIANTE',ml,y);
    doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(d.producerName,ml,y+13); y+=34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIADO',ml,y);
    doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(d.buyerName+' | CPF '+d.buyerCpf+' | '+d.buyerEmail,ml,y+13); y+=34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('OBRA',ml,y);
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text('"'+d.beatName+'"',ml,y+13); y+=36;
    doc.moveTo(ml,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(0.5).stroke(); y+=12;
    function cl(n,t,tx,yp){
      doc.fillColor(C.purple).fontSize(10).font('Helvetica-Bold').text(n+'. '+t,ml,yp);
      const ty=yp+16; doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(tx,ml,ty,{width:pw,lineGap:2});
      return ty+doc.heightOfString(tx,{width:pw,lineGap:2})+12;
    }
    y=cl('1','OBJETO','O LICENCIANTE concede ao LICENCIADO licenca na modalidade '+info.title+'.',y);
    y=cl('2','LIMITACOES',info.limits,y);
    y=cl('3','DIREITOS AUTORAIS','Direitos morais preservados conforme Lei 9.610/98 e Convencao de Berna.',y);
    y=cl('4','CONTRAPRESTACAO','Valor: '+fmtBRL(d.price)+'. Taxa ('+tier.label+'): '+fmtBRL(fee)+'. Repasse: '+fmtBRL(net)+'.',y);
    y=cl('5','VALIDADE','Valida mundialmente por prazo indeterminado conforme TRIPS e Convencao de Berna.',y);
    if(y>doc.page.height-150){doc.addPage();y=60;}
    y+=10;
    doc.moveTo(ml,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(1).stroke(); y+=18;
    doc.fillColor(C.muted).fontSize(9).text('Documento '+docId+' | '+fmtDate(new Date()),ml,y,{align:'center',width:pw});
    y+=22;
    const sw=(pw/2)-20;
    doc.moveTo(ml,y+40).lineTo(ml+sw,y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.moveTo(ml+sw+40,y+40).lineTo(ml+pw,y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.producerName,ml,y+46,{width:sw,align:'center'});
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.buyerName,ml+sw+40,y+46,{width:sw,align:'center'});
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE',ml,y+60,{width:sw,align:'center'});
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO',ml+sw+40,y+60,{width:sw,align:'center'});
    doc.end();
  });
}

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body || '';
    if(payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve({status:res.statusCode,body:JSON.parse(d)});}catch(e){resolve({status:res.statusCode,body:d});} });
    });
    req.on('error',reject);
    if(payload) req.write(payload);
    req.end();
  });
}

function clicksignAPI(method,path,body) {
  const payload = body ? JSON.stringify(body) : '';
  return httpsReq({
    hostname:'app.clicksign.com', path:path+'?access_token='+CLICKSIGN_TOKEN, method,
    headers:{'Content-Type':'application/json'}
  }, payload || undefined);
}

async function salvarLicencaDB(d) {
  if(!SUPABASE_URL||!SUPABASE_KEY) return null;
  const body=JSON.stringify({
    produtor_email:d.producerName||'desconhecido', beat_name:d.beatName,
    buyer_name:d.buyerName, buyer_cpf:d.buyerCpf, buyer_email:d.buyerEmail,
    license_type:d.licenseType, price:d.price, doc_id:d.docId||null, doc_key:d.docKey||null
  });
  return httpsReq({
    hostname:new URL(SUPABASE_URL).hostname, path:'/rest/v1/licencas', method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=minimal'}
  }, body);
}

// ── STRIPE ─────────────────────────────────────────────────────────
function stripePost(path, fields) {
  const payload = Object.keys(fields).map(k=>k+'='+encodeURIComponent(fields[k])).join('&');
  return httpsReq({
    hostname:'api.stripe.com', path, method:'POST',
    headers:{'Authorization':'Bearer '+STRIPE_SECRET,'Content-Type':'application/x-www-form-urlencoded'}
  }, payload);
}

app.post('/criar-assinatura', async (req, res) => {
  const { email, name } = req.body;
  if(!email) return res.status(400).json({ erro:'E-mail obrigatorio.' });
  try {
    const r = await stripePost('/v1/checkout/sessions', {
      'payment_method_types[]':'card',
      'mode':'subscription',
      'line_items[0][price]':STRIPE_PRICE,
      'line_items[0][quantity]':'1',
      'customer_email':email,
      'success_url':APP_URL+'/painel.html?assinatura=ativa',
      'cancel_url':APP_URL+'/?cancelado=1',
      'metadata[name]':name||'',
      'locale':'pt-BR'
    });
    if(r.body.url) {
      res.json({ sucesso:true, url:r.body.url, sessionId:r.body.id });
    } else {
      const msg = (r.body.error&&r.body.error.message)||'Erro ao criar sessao Stripe.';
      res.status(500).json({ erro:msg });
    }
  } catch(err) { res.status(500).json({ erro:err.message }); }
});

app.post('/webhook/stripe', async (req, res) => {
  res.json({ ok:true });
  try {
    const evt = req.body;
    if(evt && evt.type==='checkout.session.completed') {
      const s = evt.data.object;
      console.log('Stripe assinatura ativa:', s.customer_email, s.id);
    }
  } catch(e) { console.error('Webhook Stripe:', e.message); }
});

// ── LICENCA ─────────────────────────────────────────────────────────
app.post('/gerar-licenca', async (req, res) => {
  const { buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType,price:priceRaw } = req.body;
  for(const [f,v] of Object.entries({buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType})){
    if(!v||!String(v).trim()) return res.status(400).json({erro:'Campo ausente: '+f});
  }
  const price=parseFloat(priceRaw);
  if(isNaN(price)||price<=0) return res.status(400).json({erro:'Valor invalido.'});
  if(!LIC[licenseType]) return res.status(400).json({erro:'Tipo invalido.'});
  try {
    const {buffer,docId}=await gerarPDFBuffer({buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType,price});
    let docKey=null;
    if(CLICKSIGN_TOKEN) {
      const b64=buffer.toString('base64');
      const up=await clicksignAPI('POST','/api/v1/documents',{
        document:{path:'/licencas/'+docId+'.pdf',content_base64:'data:application/pdf;base64,'+b64,auto_close:true,locale:'pt-BR',remind_interval:3}
      });
      if(up.body.document) {
        docKey=up.body.document.key;
        await clicksignAPI('POST','/api/v1/lists',{
          list:{document_key:docKey,signer:{email:buyerEmail,auths:['email'],name:buyerName,documentation:buyerCpf.replace(/\D/g,'')},sign_as:'contractor'}
        });
        await clicksignAPI('POST','/api/v1/notifications',{document_key:docKey});
      }
    }
    await salvarLicencaDB({buyerName,buyerCpf,buyerEmail,beatName,producerName,licenseType,price,docId,docKey});
    if(CLICKSIGN_TOKEN&&docKey) {
      res.json({sucesso:true,mensagem:'Licenca enviada para '+buyerEmail+' via ClickSign!',docId,docKey});
    } else {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename="Licenca-'+docId+'.pdf"');
      res.send(buffer);
    }
  } catch(err) { res.status(500).json({erro:err.message}); }
});

app.post('/webhook/clicksign',(req,res)=>{ console.log('Webhook CS:',JSON.stringify(req.body)); res.json({ok:true}); });

app.get('/historico/:email', async (req,res) => {
  if(!SUPABASE_URL||!SUPABASE_KEY) return res.json([]);
  const path='/rest/v1/licencas?produtor_email=eq.'+encodeURIComponent(req.params.email)+'&order=created_at.desc&limit=100';
  const r=await httpsReq({
    hostname:new URL(SUPABASE_URL).hostname, path, method:'GET',
    headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}
  });
  try { res.json(Array.isArray(r.body)?r.body:[]); } catch(e) { res.json([]); }
});

app.get('/ping',(req,res)=>res.json({status:'ok',message:'BeatLicense v6 - PDF + ClickSign + Supabase + Stripe!'}));
app.listen(PORT,()=>console.log('BeatLicense porta '+PORT));
