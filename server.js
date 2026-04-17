const express = require('express');
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;
const CLICKSIGN_TOKEN = process.env.CLICKSIGN_TOKEN || '';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

app.use(express.json({ limit: '10mb' }));
app.use(cors());

const TIERS = [
  { min: 0,    max: 99,   rate: 0.05, label: '5%'  },
  { min: 100,  max: 499,  rate: 0.07, label: '7%'  },
  { min: 500,  max: 999,  rate: 0.09, label: '9%'  },
  { min: 1000, max: null, rate: 0.11, label: '11%' },
];

function getTier(v) { return TIERS.find(t => v >= t.min && (t.max === null || v <= t.max)); }
function fmtBRL(n) { return 'R$ ' + n.toFixed(2).replace('.', ','); }
function fmtDate(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); }

const LICENSE_INFO = {
  basic:     { title: 'LICENCA BASICA NAO-EXCLUSIVA',                    limits: 'Distribuicao limitada a 50.000 streams. Proibido publicidade paga.' },
  premium:   { title: 'LICENCA PREMIUM NAO-EXCLUSIVA',                   limits: 'Distribuicao limitada a 500.000 streams. Permitido redes sociais. Proibido publicidade paga.' },
  exclusive: { title: 'LICENCA EXCLUSIVA COM TRANSFERENCIA DE DIREITOS', limits: 'Uso ilimitado em todos os territorios. Inclui sincronizacao e publicidade comercial.' }
};

async function salvarLicencaDB(dados) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return new Promise((resolve) => {
    const body = JSON.stringify({
      produtor_email: dados.producerName || 'desconhecido',
      beat_name: dados.beatName,
      buyer_name: dados.buyerName,
      buyer_cpf: dados.buyerCpf,
      buyer_email: dados.buyerEmail,
      license_type: dados.licenseType,
      price: dados.price,
      doc_id: dados.docId || null,
      doc_key: dados.docKey || null
    });
    const url = new URL(SUPABASE_URL + '/rest/v1/licencas');
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal'
      }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { console.log('Supabase:', r.statusCode); resolve(d); });
    });
    req.on('error', e => { console.error('Supabase erro:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

function gerarPDFBuffer(d) {
  return new Promise((resolve, reject) => {
    const tier  = getTier(d.price);
    const fee   = d.price * tier.rate;
    const net   = d.price - fee;
    const docId = 'BL-' + new Date().getFullYear() + '-' + uuidv4().slice(0, 8).toUpperCase();
    const info  = LICENSE_INFO[d.licenseType];
    const doc   = new PDFKit({ size: 'A4', margins: { top: 60, bottom: 60, left: 70, right: 70 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve({ buffer: Buffer.concat(chunks), docId }));
    doc.on('error', reject);
    const C  = { purple: '#534AB7', dark: '#1A1A1A', muted: '#666', line: '#E0DED6', bg: '#F7F6F2' };
    const pw = doc.page.width - 140;
    const ml = 70;
    doc.rect(0, 0, doc.page.width, 80).fill(C.purple);
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('BeatLicense', ml, 24);
    doc.fillColor('#CECBF6').fontSize(9).font('Helvetica').text('Licenciamento musical automatizado', ml, 50);
    doc.fillColor('#fff').fontSize(9).text(docId, 0, 30, { align: 'right', width: doc.page.width - 70 });
    let y = 110;
    doc.fillColor(C.purple).fontSize(13).font('Helvetica-Bold').text(info.title, ml, y, { align: 'center', width: pw });
    y += 28;
    doc.moveTo(ml, y).lineTo(ml + pw, y).strokeColor(C.line).lineWidth(0.5).stroke();
    y += 12;
    doc.rect(ml, y, pw, 105).fill(C.bg);
    y += 10;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIANTE', ml, y);
    doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(d.producerName, ml, y + 13);
    y += 34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIADO', ml, y);
    doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(d.buyerName + ' | CPF ' + d.buyerCpf + ' | ' + d.buyerEmail, ml, y + 13);
    y += 34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('OBRA', ml, y);
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text('"' + d.beatName + '"', ml, y + 13);
    y += 36;
    doc.moveTo(ml, y).lineTo(ml + pw, y).strokeColor(C.line).lineWidth(0.5).stroke();
    y += 12;
    function cl(n, t, tx, yp) {
      doc.fillColor(C.purple).fontSize(10).font('Helvetica-Bold').text(n + '. ' + t, ml, yp);
      const ty = yp + 16;
      doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(tx, ml, ty, { width: pw, lineGap: 2 });
      return ty + doc.heightOfString(tx, { width: pw, lineGap: 2 }) + 12;
    }
    y = cl('1', 'OBJETO', 'O LICENCIANTE concede ao LICENCIADO licenca na modalidade ' + info.title + '.', y);
    y = cl('2', 'LIMITACOES', info.limits, y);
    y = cl('3', 'DIREITOS AUTORAIS', 'Direitos morais preservados conforme Lei 9.610/98 e Convencao de Berna.', y);
    y = cl('4', 'CONTRAPRESTACAO', 'Valor: ' + fmtBRL(d.price) + '. Taxa (' + tier.label + '): ' + fmtBRL(fee) + '. Repasse: ' + fmtBRL(net) + '.', y);
    y = cl('5', 'VALIDADE', 'Valida mundialmente por prazo indeterminado conforme TRIPS e Convencao de Berna.', y);
    if (y > doc.page.height - 150) { doc.addPage(); y = 60; }
    y += 10;
    doc.moveTo(ml, y).lineTo(ml + pw, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 18;
    doc.fillColor(C.muted).fontSize(9).text('Documento ' + docId + ' | ' + fmtDate(new Date()), ml, y, { align: 'center', width: pw });
    y += 22;
    const sw = (pw / 2) - 20;
    doc.moveTo(ml, y + 40).lineTo(ml + sw, y + 40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.moveTo(ml + sw + 40, y + 40).lineTo(ml + pw, y + 40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.producerName, ml, y + 46, { width: sw, align: 'center' });
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.buyerName, ml + sw + 40, y + 46, { width: sw, align: 'center' });
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE', ml, y + 60, { width: sw, align: 'center' });
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO', ml + sw + 40, y + 60, { width: sw, align: 'center' });
    doc.end();
  });
}

function clicksignAPI(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const fullPath = path + '?access_token=' + CLICKSIGN_TOKEN;
    const opts = {
      hostname: 'app.clicksign.com',
      path: fullPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

app.post('/gerar-licenca', async (req, res) => {
  const { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price: priceRaw } = req.body;
  for (const [f, v] of Object.entries({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType })) {
    if (!v || !String(v).trim()) return res.status(400).json({ erro: 'Campo ausente: ' + f });
  }
  const price = parseFloat(priceRaw);
  if (isNaN(price) || price <= 0) return res.status(400).json({ erro: 'Valor invalido.' });
  if (!LICENSE_INFO[licenseType]) return res.status(400).json({ erro: 'Tipo invalido.' });

  try {
    const { buffer, docId } = await gerarPDFBuffer({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price });

    let docKey = null;

    if (CLICKSIGN_TOKEN) {
      const b64 = buffer.toString('base64');
      const upload = await clicksignAPI('POST', '/api/v1/documents', {
        document: { path: '/licencas/' + docId + '.pdf', content_base64: 'data:application/pdf;base64,' + b64, auto_close: true, locale: 'pt-BR', remind_interval: 3 }
      });
      if (upload.body.document) {
        docKey = upload.body.document.key;
        await clicksignAPI('POST', '/api/v1/lists', {
          list: { document_key: docKey, signer: { email: buyerEmail, auths: ['email'], name: buyerName, documentation: buyerCpf.replace(/\D/g, '') }, sign_as: 'contractor' }
        });
        await clicksignAPI('POST', '/api/v1/notifications', { document_key: docKey });
      }
    }

    await salvarLicencaDB({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price, docId, docKey });

    if (CLICKSIGN_TOKEN && docKey) {
      res.json({ sucesso: true, mensagem: 'Licenca enviada para ' + buyerEmail + ' via ClickSign!', docId, docKey });
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Licenca-' + docId + '.pdf"');
      res.send(buffer);
    }
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/webhook/clicksign', (req, res) => {
  console.log('Webhook ClickSign:', JSON.stringify(req.body));
  res.json({ ok: true });
});

app.get('/historico/:email', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.json([]);
  const email = req.params.email;
  try {
    const result = await new Promise((resolve, reject) => {
      const path = '/rest/v1/licencas?produtor_email=eq.' + encodeURIComponent(email) + '&order=created_at.desc&limit=100';
      const opts = {
        hostname: new URL(SUPABASE_URL).hostname,
        path,
        method: 'GET',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
      };
      const req2 = https.request(opts, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve([]); } });
      });
      req2.on('error', reject);
      req2.end();
    });
    res.json(result);
  } catch(e) {
    res.json([]);
  }
});

app.get('/ping', (req, res) => res.json({ status: 'ok', message: 'BeatLicense v5 - PDF + ClickSign + Supabase!' }));

app.listen(PORT, () => console.log('BeatLicense rodando na porta ' + PORT));
