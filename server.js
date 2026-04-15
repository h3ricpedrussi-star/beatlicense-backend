const express = require('express');
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;
const CLICKSIGN_TOKEN = process.env.CLICKSIGN_TOKEN;
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  : 'http://localhost:' + PORT;

app.use(express.json());
app.use(cors());

const TIERS = [
  { min: 0,    max: 99,   rate: 0.05, label: '5%'  },
  { min: 100,  max: 499,  rate: 0.07, label: '7%'  },
  { min: 500,  max: 999,  rate: 0.09, label: '9%'  },
  { min: 1000, max: null, rate: 0.11, label: '11%' },
];

function getTier(v) {
  return TIERS.find(t => v >= t.min && (t.max === null || v <= t.max));
}
function fmtBRL(n) {
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}
function fmtDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

const LICENSE_INFO = {
  basic: {
    title: 'LICENCA BASICA NAO-EXCLUSIVA',
    limits: 'Distribuicao limitada a 50.000 streams em plataformas digitais. Proibido uso em publicidade paga.'
  },
  premium: {
    title: 'LICENCA PREMIUM NAO-EXCLUSIVA',
    limits: 'Distribuicao limitada a 500.000 streams. Permitido uso em redes sociais. Proibido publicidade paga.'
  },
  exclusive: {
    title: 'LICENCA EXCLUSIVA COM TRANSFERENCIA DE DIREITOS',
    limits: 'Uso ilimitado em todos os territorios. Inclui sincronizacao, publicidade e redistribuicao comercial.'
  }
};

function gerarPDFBuffer(dados) {
  return new Promise((resolve, reject) => {
    const { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price } = dados;
    const tier = getTier(price);
    const fee = price * tier.rate;
    const net = price - fee;
    const docId = 'BL-' + new Date().getFullYear() + '-' + uuidv4().slice(0,8).toUpperCase();
    const info = LICENSE_INFO[licenseType];
    const doc = new PDFKit({ size: 'A4', margins: { top: 60, bottom: 60, left: 70, right: 70 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), docId }));
    doc.on('error', reject);
    const C = { purple: '#534AB7', dark: '#1A1A1A', muted: '#666', line: '#E0DED6', bg: '#F7F6F2' };
    const pw = doc.page.width - 140;
    const ml = 70;
    doc.rect(0, 0, doc.page.width, 80).fill(C.purple);
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('BeatLicense', ml, 24);
    doc.fillColor('#CECBF6').fontSize(10).font('Helvetica').text('Licenciamento musical automatizado', ml, 50);
    doc.fillColor('#fff').fontSize(9).text(docId, 0, 30, { align: 'right', width: doc.page.width - 70 });
    doc.fillColor('#CECBF6').fontSize(8).text(fmtDate(new Date()), 0, 44, { align: 'right', width: doc.page.width - 70 });
    let y = 110;
    doc.fillColor(C.purple).fontSize(13).font('Helvetica-Bold').text(info.title, ml, y, { align: 'center', width: pw });
    y += 28;
    doc.moveTo(ml, y).lineTo(ml+pw, y).strokeColor(C.line).lineWidth(0.5).stroke();
    y += 14;
    doc.rect(ml, y, pw, 108).fill(C.bg);
    y += 10;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIANTE', ml, y);
    doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(producerName, ml, y+13);
    y += 34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIADO', ml, y);
    doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(buyerName + '  |  CPF ' + buyerCpf + '  |  ' + buyerEmail, ml, y+13);
    y += 34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('OBRA', ml, y);
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text('"' + beatName + '"', ml, y+13);
    y += 38;
    doc.moveTo(ml, y).lineTo(ml+pw, y).strokeColor(C.line).lineWidth(0.5).stroke();
    y += 12;
    function cl(num, titulo, texto, yp) {
      doc.fillColor(C.purple).fontSize(10).font('Helvetica-Bold').text(num+'. '+titulo, ml, yp);
      const ty = yp+16;
      doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(texto, ml, ty, { width: pw, lineGap: 3 });
      return ty + doc.heightOfString(texto, { width: pw, lineGap: 3 }) + 14;
    }
    y = cl('1','OBJETO','O LICENCIANTE concede licenca na modalidade '+info.title+'.', y);
    y = cl('2','LIMITACOES DE USO', info.limits, y);
    y = cl('3','DIREITOS AUTORAIS','Direitos morais preservados conforme Lei 9.610/98 e Convencao de Berna.', y);
    y = cl('4','CONTRAPRESTACAO','Valor pago: '+fmtBRL(price)+'. Taxa ('+tier.label+'): '+fmtBRL(fee)+'. Repasse: '+fmtBRL(net)+'.', y);
    y = cl('5','VALIDADE','Valida mundialmente por prazo indeterminado conforme TRIPS e Convencao de Berna.', y);
    if (y > doc.page.height - 160) { doc.addPage(); y = 60; }
    y += 10;
    doc.moveTo(ml, y).lineTo(ml+pw, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 20;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('Documento '+docId+' | Emitido eletronicamente', ml, y, { align: 'center', width: pw });
    y += 20;
    const sw = (pw/2)-20;
    doc.moveTo(ml, y+40).lineTo(ml+sw, y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.moveTo(ml+sw+40, y+40).lineTo(ml+pw, y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(producerName, ml, y+46, { width: sw, align: 'center' });
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(buyerName, ml+sw+40, y+46, { width: sw, align: 'center' });
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE', ml, y+60, { width: sw, align: 'center' });
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO', ml+sw+40, y+60, { width: sw, align: 'center' });
    doc.end();
  });
}

function clicksignRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://app.clicksign.com' + path + '?access_token=' + CLICKSIGN_TOKEN);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.post('/gerar-licenca', async (req, res) => {
  const { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price: priceRaw } = req.body;
  const required = { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType };
  for (const [f, v] of Object.entries(required)) {
    if (!v || !String(v).trim()) return res.status(400).json({ erro: 'Campo ausente: ' + f });
  }
  const price = parseFloat(priceRaw);
  if (isNaN(price) || price <= 0) return res.status(400).json({ erro: 'Valor invalido.' });
  if (!LICENSE_INFO[licenseType]) return res.status(400).json({ erro: 'Tipo invalido.' });

  try {
    const { buffer, docId } = await gerarPDFBuffer({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price });

    if (!CLICKSIGN_TOKEN) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Licenca-' + beatName.replace(/\s+/g,'-') + '-' + docId + '.pdf"');
      return res.send(buffer);
    }

    const b64 = buffer.toString('base64');
    const uploadRes = await clicksignRequest('POST', '/api/v1/documents', {
      document: {
        path: '/licencas/' + docId + '.pdf',
        content_base64: 'data:application/pdf;base64,' + b64,
        deadline_at: null,
        auto_close: true,
        locale: 'pt-BR',
        remind_interval: 3,
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;
const CLICKSIGN_TOKEN = process.env.CLICKSIGN_TOKEN;

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
  basic:     { title: 'LICENCA BASICA NAO-EXCLUSIVA',                    limits: 'Distribuicao limitada a 50.000 streams. Proibido uso em publicidade paga.' },
  premium:   { title: 'LICENCA PREMIUM NAO-EXCLUSIVA',                   limits: 'Distribuicao limitada a 500.000 streams. Permitido redes sociais. Proibido publicidade paga.' },
  exclusive: { title: 'LICENCA EXCLUSIVA COM TRANSFERENCIA DE DIREITOS', limits: 'Uso ilimitado em todos os territorios. Inclui sincronizacao e publicidade comercial.' }
};

function gerarPDFBuffer(d) {
  return new Promise((resolve, reject) => {
    const tier = getTier(d.price);
    const fee  = d.price * tier.rate;
    const net  = d.price - fee;
    const docId = 'BL-' + new Date().getFullYear() + '-' + uuidv4().slice(0,8).toUpperCase();
    const info  = LICENSE_INFO[d.licenseType];
    const doc   = new PDFKit({ size: 'A4', margins: { top: 60, bottom: 60, left: 70, right: 70 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), docId }));
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
    doc.moveTo(ml,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(0.5).stroke(); y += 12;
    doc.rect(ml, y, pw, 105).fill(C.bg); y += 10;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIANTE', ml, y);
    doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(d.producerName, ml, y+13); y += 34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIADO', ml, y);
    doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(d.buyerName+' | CPF '+d.buyerCpf+' | '+d.buyerEmail, ml, y+13); y += 34;
    doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('OBRA', ml, y);
    doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text('"'+d.beatName+'"', ml, y+13); y += 36;
    doc.moveTo(ml,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(0.5).stroke(); y += 12;
    function cl(n,t,tx,yp) {
      doc.fillColor(C.purple).fontSize(10).font('Helvetica-Bold').text(n+'. '+t, ml, yp);
      const ty = yp+16;
      doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(tx, ml, ty, { width: pw, lineGap: 2 });
      return ty + doc.heightOfString(tx, { width: pw, lineGap: 2 }) + 12;
    }
    y = cl('1','OBJETO','O LICENCIANTE concede ao LICENCIADO licenca na modalidade '+info.title+'.', y);
    y = cl('2','LIMITACOES DE USO', info.limits, y);
    y = cl('3','DIREITOS AUTORAIS','Direitos morais preservados conforme Lei 9.610/98 e Convencao de Berna.', y);
    y = cl('4','CONTRAPRESTACAO','Valor pago: '+fmtBRL(d.price)+'. Taxa ('+tier.label+'): '+fmtBRL(fee)+'. Repasse ao produtor: '+fmtBRL(net)+'.', y);
    y = cl('5','VALIDADE','Valida mundialmente por prazo indeterminado conforme TRIPS e Convencao de Berna.', y);
    if (y > doc.page.height - 150) { doc.addPage(); y = 60; }
    y += 10;
    doc.moveTo(ml,y).lineTo(ml+pw,y).strokeColor(C.line).lineWidth(1).stroke(); y += 18;
    doc.fillColor(C.muted).fontSize(9).text('Documento '+docId+' | Emitido eletronicamente em '+fmtDate(new Date()), ml, y, { align:'center', width:pw });
    y += 20;
    const sw = (pw/2)-20;
    doc.moveTo(ml, y+40).lineTo(ml+sw, y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.moveTo(ml+sw+40, y+40).lineTo(ml+pw, y+40).strokeColor(C.dark).lineWidth(0.5).stroke();
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.producerName, ml, y+46, { width:sw, align:'center' });
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(d.buyerName, ml+sw+40, y+46, { width:sw, align:'center' });
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE', ml, y+60, { width:sw, align:'center' });
    doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO', ml+sw+40, y+60, { width:sw, align:'center' });
    doc.end();
  });
}

function clicksignAPI(method, path, body) {
  return new Promise((resolve, reject) => {
    const fullPath = path + '?access_token=' + CLICKSIGN_TOKEN;
    const opts = { hostname: 'app.clicksign.com', path: fullPath, method, headers: { 'Content-Type': 'application/json' } };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.post('/gerar-licenca', async (req, res) => {
  const { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price: priceRaw } = req.body;
  for (const [f,v] of Object.entries({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType })) {
    if (!v || !String(v).trim()) return res.status(400).json({ erro: 'Campo ausente: '+f });
  }
  const price = parseFloat(priceRaw);
  if (isNaN(price) || price <= 0) return res.status(400).json({ erro: 'Valor invalido.' });
  if (!LICENSE_INFO[licenseType]) return res.status(400).json({ erro: 'Tipo invalido.' });

  try {
    const { buffer, docId } = await gerarPDFBuffer({ buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price });

    if (!CLICKSIGN_TOKEN) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Licenca-'+docId+'.pdf"');
      return res.send(buffer);
    }

    const b64 = buffer.toString('base64');
    const upload = await clicksignAPI('POST', '/api/v1/documents', {
      document: {
        path: '/licencas/'+docId+'.pdf',
        content_base64: 'data:application/pdf;base64,'+b64,
        auto_close: true,
        locale: 'pt-BR',
        remind_interval: 3,
        message: 'Sua licenca do beat "'+beatName+'" esta pronta. Clique para assinar.'
      }
    });

    if (!upload.body.document) {
      console.error('ClickSign erro upload:', JSON.stringify(upload.body));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Licenca-'+docId+'.pdf"');
      return res.send(buffer);
    }

    const docKey = upload.body.document.key;

    await clicksignAPI('POST', '/api/v1/lists', {
      list: {
        document_key: docKey,
        signer: { email: buyerEmail, auths: ['email'], name: buyerName, documentation: buyerCpf.replace(/\D/g,'') },
        sign_as: 'contractor'
      }
    });

    await clicksignAPI('POST', '/api/v1/notifications', { document_key: docKey });

    res.json({ sucesso: true, mensagem: 'Licenca enviada para '+buyerEmail+' via ClickSign!', docId, docKey });

  } catch (err) {
    console.error('Erro interno:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

app.post('/webhook/clicksign', (req, res) => {
  console.log('Webhook ClickSign:', JSON.stringify(req.body));
  res.json({ ok: true });
});

app.get('/ping', (req, res) => res.json({ status: 'ok', message: 'BeatLicense Camada 3 - ClickSign integrado!' }));

app.listen(PORT, () => console.log('BeatLicense rodando na porta ' + PORT));
