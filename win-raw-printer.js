/**
 * Módulo de Impresión RAW ESC/POS Nativa para Windows (winspool.drv)
 * Permite imprimir directo a impresoras térmicas USB (ej: 3nStar RPT004 / POS-80C)
 * sin reemplazar drivers, sin Zadig y sin ventana "Guardar como PDF".
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 20000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error((stderr || err.message || 'Error ejecutando PowerShell').trim()));
        }
        resolve((stdout || '').trim());
      }
    );
  });
}

function isThermalPrinterName(name = '', driver = '') {
  const combined = `${name} ${driver}`.toLowerCase();
  const keywords = ['pos', '80c', '80mm', '58mm', '3nstar', 'rpt', 'thermal', 'termica', 'tm-t', 'epson', 'xprinter', 'xp-', 'gadnic', 'hasar', 'bixolon', 'star', 'receipt', 'comanda'];
  return keywords.some(k => combined.includes(k));
}

async function listWindowsPrinters() {
  if (process.platform !== 'win32') {
    return [];
  }

  const psScript = `
    $printers = Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus
    if ($null -eq $printers) { '[]' } else { $printers | ConvertTo-Json -Compress }
  `;

  const raw = await runPowerShell(psScript);
  if (!raw) return [];

  let parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) parsed = [parsed];

  const list = parsed
    .filter(p => p && p.Name)
    .map(p => {
      const name = String(p.Name);
      const driver = String(p.DriverName || '');
      const port = String(p.PortName || '');
      const isVirtual = /pdf|onenote|xps|fax/i.test(`${name} ${driver} ${port}`);
      const isThermal = isThermalPrinterName(name, driver);
      return {
        name,
        driver,
        port,
        status: String(p.PrinterStatus || 'Normal'),
        isThermal,
        isVirtual
      };
    });

  // Ordenar: primero impresoras térmicas físicas, luego otras físicas, al final virtuales
  list.sort((a, b) => {
    if (a.isThermal !== b.isThermal) return a.isThermal ? -1 : 1;
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return list;
}

async function sendRawBytesToWindowsPrinter(printerName, buffer) {
  if (process.platform !== 'win32') {
    throw new Error('Impresión RAW directa de Windows solo disponible en equipos Windows.');
  }
  if (!printerName || !String(printerName).trim()) {
    throw new Error('Debes indicar el nombre de la impresora.');
  }
  if (!buffer || buffer.length === 0) {
    throw new Error('No hay datos ESC/POS para imprimir.');
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `rivera-raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`
  );

  fs.writeFileSync(tmpFile, buffer);

  const safePrinter = String(printerName).replace(/'/g, "''");
  const safePath = tmpFile.replace(/'/g, "''");

  const psScript = `
$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RiveraRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static void SendFile(string printerName, string filePath) {
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr hPrinter = IntPtr.Zero;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            throw new Exception("No se pudo abrir la impresora '" + printerName + "' (Error Win32: " + Marshal.GetLastWin32Error() + ")");
        }
        try {
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "Rivera POS Ticket";
            di.pDataType = "RAW";
            if (!StartDocPrinter(hPrinter, 1, di)) {
                throw new Exception("Error iniciando documento RAW (Win32: " + Marshal.GetLastWin32Error() + ")");
            }
            try {
                if (!StartPagePrinter(hPrinter)) {
                    throw new Exception("Error iniciando pagina RAW (Win32: " + Marshal.GetLastWin32Error() + ")");
                }
                try {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    try {
                        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                        int written = 0;
                        if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written)) {
                            throw new Exception("Error escribiendo bytes RAW (Win32: " + Marshal.GetLastWin32Error() + ")");
                        }
                    } finally {
                        Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    }
                } finally {
                    EndPagePrinter(hPrinter);
                }
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
"@

if (-not ("RiveraRawPrinter" -as [type])) {
    Add-Type -TypeDefinition $code -Language CSharp
}
[RiveraRawPrinter]::SendFile('${safePrinter}', '${safePath}')
Write-Output "OK"
  `;

  try {
    await runPowerShell(psScript);
    return { success: true, printer: printerName, bytes: buffer.length };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (_) {}
  }
}

module.exports = {
  listWindowsPrinters,
  sendRawBytesToWindowsPrinter
};
