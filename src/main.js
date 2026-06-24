const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { scanWebsite } = require('./scanner');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'Cookie Audit Scanner',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('scan:start', async (_event, options) => {
  return await scanWebsite(options, progress => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', progress);
    }
  });
});

ipcMain.handle('file:save', async (_event, { defaultPath, content, type }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: type === 'csv'
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) return { saved: false };

  fs.writeFileSync(result.filePath, content, 'utf8');
  return { saved: true, path: result.filePath };
});

ipcMain.handle('pdf:save', async (_event, { html, defaultPath }) => {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1240,
    height: 1754,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await pdfWindow.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    );

    await pdfWindow.webContents.executeJavaScript(`
      new Promise(resolve => {
        if (document.readyState === 'complete') resolve();
        else window.addEventListener('load', resolve);
      });
    `);

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      margins: {
        marginType: 'custom',
        top: 0.4,
        bottom: 0.4,
        left: 0.4,
        right: 0.4
      }
    });

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || 'cookie-audit-report.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) return { saved: false };

    fs.writeFileSync(result.filePath, pdfBuffer);
    return { saved: true, path: result.filePath };
  } finally {
    pdfWindow.close();
  }
});
