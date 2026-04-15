const express = require('express');
const cors = require('cors');
const PDFKit = require('pdfkit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors());

const TIERS = [
  { min: 0,    max: 99,   rate: 0.05, label: '5%'  },
  { min: 100,  max: 499,  rate: 0.07, label: '7%'  },
  { min: 500,  max: 999,  rate: 0.09, label: '9%'  },
  { min: 1000, max: null, rate: 0.11, label: '11%' },
];

function getTier(value) {
  return TIERS.find(t => value >= t.min && (t.max === null || value <= t.max));
}

function fmtBRL(n) {
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDate(date) {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

const LICENSE_INFO = {
  basic: {
    title: 'LICENCA BASICA NAO-EXCLUSIVA',
    limits: 'Distribuicao limitada a 50.000 streams em plataformas digitais. Proibido uso em publicidade paga ou midia audiovisual remunerada.'
  },
  premium: {
    title: 'LICENCA PREMIUM NAO-EXCLUSIVA',
    limits: 'Distribuicao limitada a 500.000 streams. Permitido uso em videos nao comerciais e redes sociais. Proibido uso em publicidade paga.'
  },
  exclusive: {
    title: 'LICENCA EXCLUSIVA COM TRANSFERENCIA DE DIREITOS',
    limits: 'Uso ilimitado em todos os territorios e plataformas. Inclui direito de sincronizacao, publicidade e redistribuicao comercial.'
  }
};

app.post('/gerar-licenca', (req, res) => {
  const { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType, price: priceRaw } = req.body;

  const required = { buyerName, buyerCpf, buyerEmail, beatName, producerName, licenseType };
  for (const [field, value] of Object.entries(required)) {
    if (!value || String(value).trim() === '') {
      return res.status(400).json({ erro: 'Campo obrigatorio ausente: ' + field });
    }
  }

  const price = parseFloat(priceRaw);
  if (isNaN(price) || price <= 0) return res.status(400).json({ erro: 'Valor invalido.' });
  if (!LICENSE_INFO[licenseType]) return res.status(400).json({ erro: 'Tipo de licenca invalido.' });

  const tier = getTier(price);
  const fee = price * tier.rate;
  const netValue = price - fee;
  const docId = 'BL-' + new Date().getFullYear() + '-' + uuidv4().slice(0, 8).toUpperCase();
  const now = new Date();
  const info = LICENSE_INFO[licenseType];

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Licenca-${beatName.replace(/\s+/g,'-')}-${docId}.pdf"`);

  const doc = new PDFKit({ size: 'A4', margins: { top: 60, bottom: 60, left: 70, right: 70 } });
  doc.pipe(res);

  const C = { purple: '#534AB7', dark: '#1A1A1A', muted: '#666666', line: '#E0DED6', bg: '#F7F6F2' };
  const pageWidth = doc.page.width - 140;
  const marginLeft = 70;

  doc.rect(0, 0, doc.page.width, 80).fill(C.purple);
  doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('BeatLicense', marginLeft, 24);
  doc.fillColor('#CECBF6').fontSize(10).font('Helvetica').text('Plataforma de licenciamento musical', marginLeft, 50);
  doc.fillColor('#FFFFFF').fontSize(9).text(docId, 0, 30, { align: 'right', width: doc.page.width - 70 });
  doc.fillColor('#CECBF6').fontSize(8).text(fmtDate(now), 0, 44, { align: 'right', width: doc.page.width - 70 });

  let y = 110;
  doc.fillColor(C.purple).fontSize(13).font('Helvetica-Bold').text(info.title, marginLeft, y, { align: 'center', width: pageWidth });
  y += 30;
  doc.moveTo(marginLeft, y).lineTo(marginLeft + pageWidth, y).strokeColor(C.line).lineWidth(1).stroke();
  y += 20;

  doc.rect(marginLeft, y, pageWidth, 110).fill(C.bg);
  y += 12;

  doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIANTE', marginLeft, y);
  doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(producerName, marginLeft, y + 13);
  y += 36;

  doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('LICENCIADO', marginLeft, y);
  doc.fillColor(C.dark).fontSize(11).font('Helvetica').text(buyerName + '  |  CPF ' + buyerCpf + '  |  ' + buyerEmail, marginLeft, y + 13);
  y += 36;

  doc.fillColor(C.muted).fontSize(9).font('Helvetica-Bold').text('OBRA', marginLeft, y);
  doc.fillColor(C.dark).fontSize(12).font('Helvetica-Bold').text('"' + beatName + '"', marginLeft, y + 13);
  y += 36;

  doc.moveTo(marginLeft, y).lineTo(marginLeft + pageWidth, y).strokeColor(C.line).lineWidth(0.5).stroke();
  y += 14;

  function clausula(num, titulo, texto, yPos) {
    doc.fillColor(C.purple).fontSize(10).font('Helvetica-Bold').text(num + '. ' + titulo, marginLeft, yPos);
    const textY = yPos + 16;
    doc.fillColor(C.dark).fontSize(10).font('Helvetica').text(texto, marginLeft, textY, { width: pageWidth, lineGap: 3 });
    const h = doc.heightOfString(texto, { width: pageWidth, lineGap: 3 });
    return textY + h + 16;
  }

  y = clausula('1', 'OBJETO', 'O LICENCIANTE concede ao LICENCIADO licenca de uso na modalidade ' + info.title + '.', y);
  y = clausula('2', 'LIMITACOES DE USO', info.limits, y);
  y = clausula('3', 'DIREITOS AUTORAIS', 'O LICENCIANTE permanece como autor nos termos da Lei 9.610/98 e da Convencao de Berna.', y);
  y = clausula('4', 'CONTRAPRESTACAO', 'Valor pago: ' + fmtBRL(price) + '. Taxa (' + tier.label + '): ' + fmtBRL(fee) + '. Repasse ao produtor: ' + fmtBRL(netValue) + '.', y);
  y = clausula('5', 'VALIDADE', 'Licenca valida mundialmente por prazo indeterminado conforme TRIPS e Convencao de Berna.', y);

  if (y > doc.page.height - 160) { doc.addPage(); y = 60; }

  y += 10;
  doc.moveTo(marginLeft, y).lineTo(marginLeft + pageWidth, y).strokeColor(C.line).lineWidth(1).stroke();
  y += 24;

  doc.fillColor(C.muted).fontSize(9).font('Helvetica')
     .text('Emitido eletronicamente | Documento ' + docId, marginLeft, y, { align: 'center', width: pageWidth });
  y += 20;

  const sigWidth = (pageWidth / 2) - 20;
  doc.moveTo(marginLeft, y + 40).lineTo(marginLeft + sigWidth, y + 40).strokeColor(C.dark).lineWidth(0.5).stroke();
  doc.moveTo(marginLeft + sigWidth + 40, y + 40).lineTo(marginLeft + pageWidth, y + 40).strokeColor(C.dark).lineWidth(0.5).stroke();
  doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(producerName, marginLeft, y + 46, { width: sigWidth, align: 'center' });
  doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold').text(buyerName, marginLeft + sigWidth + 40, y + 46, { width: sigWidth, align: 'center' });
  doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIANTE', marginLeft, y + 60, { width: sigWidth, align: 'center' });
  doc.fillColor(C.muted).fontSize(9).font('Helvetica').text('LICENCIADO', marginLeft + sigWidth + 40, y + 60, { width: sigWidth, align: 'center' });

  doc.end();
});

app.get('/ping', (req, res) => res.json({ status: 'ok', message: 'BeatLicense online!' }));

app.listen(PORT, () => console.log('BeatLicense rodando na porta ' + PORT));
