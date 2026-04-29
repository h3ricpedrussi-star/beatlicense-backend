const express = require('express');
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const crypto = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3001;
const RESEND_KEY   = process.env.RESEND_API_KEY    || '';
const SB_URL       = process.env.SUPABASE_URL      || '';
const SB_KEY       = process.env.SUPABASE_KEY      || '';
const STRIPE_SEC   = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRC   = process.env.STRIPE_PRICE_ID   || '';
const STRIPE_WH    = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL      = process.env.APP_URL || 'https://www.beatlicense.com.br';

app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const TIERS = [
  {min:0,   max:99,   rate:0.05, label:'5%'},
  {min:100, max:499,  rate:0.07, label:'7%'},
  {min:500, max:999,  rate:0.09, label:'9%'},
  {min:1000,max:null, rate:0.11, label:'11%'}
];
const LIC = {
  basic:    {title:'LICENCA BASICA NAO-EXCLUSIVA',    limits:'Distribuicao limitada a 50.000 streams.'},
  premium:  {title:'LICENCA PREMIUM NAO-EXCLUSIVA',   limits:'Distribuicao limitada a 500.000 streams.'},
  exclusive:{title:'LICENCA EXCLUSIVA',               limits:'Uso ilimitado em todos os territorios.'}
};

function getTier(v){ return TIERS.find(t=>v>=t.min&&(t.max===null||v<=t.max)); }
function fmtBRL(n){ return 'R$ '+n.toFixed(2).replace('.',','); }
function fmtDate(d){ return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}); }

// ── HTTP helper ──────────────────────────────────────────────────────────────
function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body || '';
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Gera PDF ─────────────────────────────────────────────────────────────────
function gerarPDF(d) {
  return new Promise((resolve, reject) => {
    const tier = getTier(d.price);
    const fee  = d.price * tier.rate;
    const net  = d.price - fee;
    const docId = 'BL-' + new Date().getFullYear() + '-' + uuidv4().slice(0,8).toUpperCase();
    const info  = LIC[d.licenseType];
    const doc   = new PDFKit({ size: 'A4', margins: { top:60, bottom:60, left:70, right:70 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), docId }));
    doc.on('error', reject);

    const ml = 70, pw = doc.page.width - 140, sw = (pw / 2) - 20;
    const C = { purple:'#534AB7', dark:'#1A1A1A', muted:'#666', line:'#E0DED6', bg:'#F7F6F2' };

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill(C.purple);
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('BeatLicense', ml, 24);
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(10).font('Helvetica').text('Licenciamento Digital Profissional', ml+2, 50);

    let y = 100;
    doc.fillColor(C.muted).fontSize(9).text('Documento ' + docId + '  |  ' + fmtDate(new Date()), ml, y, { align:'center', width:pw });
    y += 26;

    // Título licença
    doc.rect(ml, y, pw, 34).fill(C.purple);
    doc.fillColor('#fff').fontSize(12).font('Helvetica-Bold').text(info.title, ml, y+11, { align:'center', width:pw });
    y += 46;

    // Beat
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text('BEAT: ' + d.beatName.toUpperCase(), ml, y);
    y += 18;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('Produzido por ' + d.producerName, ml, y);
    y += 28;

    // Valores
    doc.rect(ml, y, pw, 62).fill(C.bg);
    doc.fillColor(C.muted).fontSize(8).text('Valor da venda', ml+12, y+8);
    doc.fillColor(C.dark).fontSize(14).font('Helvetica-Bold').text(fmtBRL(d.price), ml+12, y+20);
    doc.fillColor(C.muted).fontSize(8).font('Helvetica').text('Royalty ('+tier.label+')', ml+140, y+8);
    doc.fillColor(C.dark).fontSize(13).font('Helvetica-Bold').text(fmtBRL(fee), ml+140, y+20);
    doc.fillColor(C.muted).fontSize(8).font('Helvetica').text('Valor liquido', ml+270, y+8);
    doc.fillColor(C.dark).fontSize(13).font('Helvetica-Bold').text(fmtBRL(net), ml+270, y+20);
    y += 74;

    // Termos
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text('TERMOS DA LICENCA', ml, y);
    y += 14;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text(info.limits, ml, y, { width:pw });
    y += 20;
    doc.fillColor(C.muted).fontSize(8).text(
      'O licenciado (' + d.buyerName + ', CPF: ' + d.buyerCpf + ') adquire os direitos de uso do beat conforme os termos acima. Valido a partir de ' + fmtDate(new Date()) + '.',
      ml, y, { width:pw }
    );
    y += 50;

    // Assinaturas
    doc.moveTo(ml, y).lineTo(ml+sw, y).strokeColor(C.line).lineWidth(1).stroke();
    doc.moveTo(ml+sw+40, y).lineTo(ml+pw, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 8;
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.producerName, ml, y, { width:sw, align:'center' });
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.buyerName, ml+sw+40, y, { width:sw, align:'center' });
    y += 14;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE', ml, y, { width:sw, align:'center' });
    doc.fillColor(C.muted).fontSize(9).text('LICENCIADO', ml+sw+40, y, { width:sw, align:'center' });
    doc.end();
  });
}

// ── Envia email via Resend ────────────────────────────────────────────────────
async function enviarEmail({ to, toName, producerName, beatName, docId, pdfBuffer }) {
  console.log('Resend: enviando para', to, '| key presente:', !!RESEND_KEY);
  const pdfB64 = pdfBuffer.toString('base64');
  const html = '<div style="font-family:sans-serif;max-width:520px;margin:0 auto">'
    + '<div style="background:#534AB7;padding:24px;border-radius:8px 8px 0 0">'
    + '<h1 style="color:white;margin:0;font-size:20px">BeatLicense</h1>'
    + '<p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:13px">Licenciamento Digital Profissional</p>'
    + '</div>'
    + '<div style="background:#f9f9f9;padding:28px;border-radius:0 0 8px 8px;border:1px solid #e8e8e8">'
    + '<p style="font-size:15px;color:#1d1d1f">Ola, <strong>' + toName + '</strong>!</p>'
    + '<p style="color:#555;font-size:14px">Sua licenca para o beat <strong>"' + beatName + '"</strong> produzido por <strong>' + producerName + '</strong> esta pronta!</p>'
    + '<p style="color:#555;font-size:14px">O PDF da licenca esta em anexo. Documento: <strong>' + docId + '</strong></p>'
    + '<div style="background:white;border:1px solid #e0e0e0;border-radius:6px;padding:16px;margin:20px 0">'
    + '<p style="color:#534AB7;font-weight:bold;margin:0 0 6px">Licenca em anexo</p>'
    + '<p style="color:#888;font-size:12px;margin:0">Guarde este documento — e sua comprovacao legal de uso do beat.</p>'
    + '</div>'
    + '<p style="color:#aaa;font-size:11px;margin-top:24px">BeatLicense • beatlicense.com.br</p>'
    + '</div></div>';

  const body = JSON.stringify({
    from: 'BeatLicense <onboarding@resend.dev>',
    to: [to],
    subject: 'Sua licenca do beat "' + beatName + '" esta pronta!',
    html: html,
    attachments: [{ filename: docId + '.pdf', content: pdfB64 }]
  });

  const resp = await httpsReq({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY }
  }, body);

  console.log('Resend response status:', resp.status, '| body:', JSON.stringify(resp.body).slice(0, 300));
  return resp;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
async function salvarLicenca(d) {
  if (!SB_URL || !SB_KEY) return;
  const body = JSON.stringify({
    produtor_email: d.producerName, beat_name: d.beatName,
    buyer_name: d.buyerName, buyer_cpf: d.buyerCpf,
    buyer_email: d.buyerEmail, license_type: d.licenseType,
    price: d.price, doc_id: d.docId
  });
  return httpsReq({
    hostname: new URL(SB_URL).hostname,
    path: '/rest/v1/licencas', method: 'POST',
    headers: { 'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Prefer':'return=minimal' }
  }, body);
}

// ── Stripe helpers ────────────────────────────────────────────────────────────
function stripePost(path, fields) {
  const payload = Object.keys(fields).map(k => k + '=' + encodeURIComponent(fields[k])).join('&');
  return httpsReq({
    hostname: 'api.stripe.com', path, method: 'POST',
    headers: { 'Authorization':'Bearer '+STRIPE_SEC, 'Content-Type':'application/x-www-form-urlencoded' }
  }, payload);
}
function verifyStripe(rawBody, sig, secret) {
  try {
    const parts = sig.split(',').reduce((a,p) => { const[k,v]=p.split('='); a[k]=v; return a; }, {});
    const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + rawBody, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch(e) { return false; }
}

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.get('/ping', (_, res) => res.json({ status:'ok', message:'BeatLicense v9 - Resend OK' }));

app.post('/criar-assinatura', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ erro: 'Email obrigatorio' });
  try {
    const session = await stripePost('/v1/checkout/sessions', {
      'payment_method_types[]': 'card',
      'line_items[0][price]': STRIPE_PRC,
      'line_items[0][quantity]': '1',
      mode: 'subscription',
      success_url: APP_URL + '/painel?assinatura=ativa',
      cancel_url: APP_URL + '/?cancelado=1',
      customer_email: email,
      'metadata[name]': name || ''
    });
    if (!session.body.url) return res.status(500).json({ erro: 'Erro ao criar sessao' });
    res.json({ url: session.body.url });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!verifyStripe(req.body, sig, STRIPE_WH)) return res.status(400).json({ erro: 'Assinatura invalida' });
  res.json({ ok: true });
  try {
    const evt = JSON.parse(req.body.toString());
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;
      if (SB_URL && SB_KEY && s.customer_email) {
        httpsReq({
          hostname: new URL(SB_URL).hostname, path: '/rest/v1/produtores', method: 'POST',
          headers: { 'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Prefer':'resolution=merge-duplicates,return=minimal' }
        }, JSON.stringify({ email:s.customer_email, nome:(s.metadata&&s.metadata.name)||'', plano:'pro', ativo:true, stripe_session:s.id }))
          .catch(e => console.error('Supabase webhook erro:', e.message));
      }
    }
  } catch(e) { console.error('Webhook erro:', e.message); }
});

app.post('/gerar-licenca', async (req, res) => {
  const { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price: priceRaw } = req.body;
  for (const [f, v] of Object.entries({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType })) {
    if (!v || !String(v).trim()) return res.status(400).json({ erro: 'Campo ausente: ' + f });
  }
  const price = parseFloat(priceRaw);
  if (isNaN(price) || price <= 0) return res.status(400).json({ erro: 'Valor invalido.' });
  if (!LIC[licenseType]) return res.status(400).json({ erro: 'Tipo invalido.' });

  try {
    const { buffer, docId } = await gerarPDF({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price });
    console.log('PDF gerado:', docId, 'para', buyerEmail);

    if (RESEND_KEY) {
      await enviarEmail({ to: buyerEmail, toName: buyerName, producerName, beatName, docId, pdfBuffer: buffer });
    } else {
      console.log('RESEND_KEY nao configurada - email nao enviado');
    }

    await salvarLicenca({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price, docId });
    res.json({ sucesso: true, mensagem: 'Licenca enviada para ' + buyerEmail + '!', docId });
  } catch(err) {
    console.error('Erro gerar-licenca:', err.message, err.stack);
    res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, () => console.log('BeatLicense porta', PORT));
