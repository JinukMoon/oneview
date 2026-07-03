// Single browser bundle: exposes pdf.js, @rhwp/core (HWP/HWPX WASM), and the
// Capacitor JS runtime on window for the no-bundler WebView app.
import * as pdfjsLib from 'pdfjs-dist';
import rhwpInit, { HwpDocument as RhwpDocument } from '@rhwp/core';
import { registerPlugin, Capacitor as CapCore } from '@capacitor/core';
import { renderAsync as docxRender } from 'docx-preview';
import * as XLSX from 'xlsx';

import { App as CapApp } from '@capacitor/app';
import { unzipSync, zipSync } from 'fflate';
import * as JVPptx from './pptx/index.js';
import ExcelJS from 'exceljs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.js';

window.pdfjsLib = pdfjsLib;
window.rhwpInit = rhwpInit;          // call once with the .wasm URL
window.RhwpDocument = RhwpDocument;  // new RhwpDocument(Uint8Array)
window.JVRegisterPlugin = registerPlugin;
window.JVCapacitor = CapCore;
window.docxRender = docxRender;
window.XLSX = XLSX;
window.JVPptx = JVPptx;              // self PPTX renderer: parse / renderInto / summarizeModel
window.JVUnzip = unzipSync;
window.JVZip = zipSync;
window.ExcelJS = ExcelJS;
window.JVApp = CapApp; // Capacitor App plugin — hardware back button handling
