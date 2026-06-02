// Single browser bundle: exposes pdf.js, hwp.js, and the Capacitor JS runtime
// on window for the no-bundler WebView app.
import * as pdfjsLib from 'pdfjs-dist';
import { Viewer as HWPViewer } from 'hwp.js';
import { registerPlugin, Capacitor as CapCore } from '@capacitor/core';
import { renderAsync as docxRender } from 'docx-preview';
import * as XLSX from 'xlsx';
import { init as pptxInit } from 'pptx-preview';
import { unzipSync } from 'fflate';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.js';

window.pdfjsLib = pdfjsLib;
window.HWPViewer = HWPViewer;
window.JVRegisterPlugin = registerPlugin;
window.JVCapacitor = CapCore;
window.docxRender = docxRender;
window.XLSX = XLSX;
window.pptxInit = pptxInit;
window.JVUnzip = unzipSync;
