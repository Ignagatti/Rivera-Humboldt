/**
 * Puente Local de Impresión Térmica Directa (Windows -> 3nStar RPT004 / POS-80C)
 * Escucha en http://127.0.0.1:9100 para que Sarmiento POS (tanto local como desde Vercel HTTPS)
 * pueda enviar comandos ESC/POS RAW directo a la impresora térmica instalada en Windows.
 */

const http = require('http');
const { listWindowsPrinters, sendRawBytesToWindowsPrinter } = require('./win-raw-printer');

const PORT = Number(process.env.PRINT_BRIDGE_PORT) || 9100;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'Sarmiento Print Bridge', port: PORT }));
    return;
  }

  if (req.method === 'GET' && req.url === '/printers') {
    try {
      const printers = await listWindowsPrinters();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, printers }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/print') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const { printerName, dataBase64 } = parsed;
        if (!printerName || !dataBase64) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Falta printerName o dataBase64' }));
          return;
        }
        const buffer = Buffer.from(dataBase64, 'base64');
        const result = await sendRawBytesToWindowsPrinter(printerName, buffer);
        console.log(`[IMPRESO OK] ${printerName} (${buffer.length} bytes ESC/POS)`);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[ERROR IMPRESION]', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: 'Ruta no encontrada' }));
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('======================================================');
  console.log('  SARMIENTO POS - PUENTE DE IMPRESION TERMICA DIRECTA');
  console.log(`  Activo en: http://127.0.0.1:${PORT}`);
  console.log('======================================================');
  try {
    const printers = await listWindowsPrinters();
    if (printers.length === 0) {
      console.log('No se detectaron impresoras en Windows.');
    } else {
      console.log('Impresoras detectadas en Windows:');
      printers.forEach(p => {
        console.log(`  - ${p.name} [${p.port}] ${p.isThermal ? '(TERMICA RECOMENDADA)' : ''}`);
      });
    }
  } catch (e) {
    console.warn('No se pudieron listar impresoras al inicio:', e.message);
  }
  console.log('\nDeja esta ventana abierta mientras uses la comandera en cocina.');
});
