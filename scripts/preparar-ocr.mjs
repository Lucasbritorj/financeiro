import {mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const destino=resolve('public/ocr');await mkdir(destino,{recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js',resolve(destino,'worker.min.js'));
for(const nome of await readdir('node_modules/tesseract.js-core'))if(/\.wasm(?:\.js)?$/.test(nome))await copyFile(resolve('node_modules/tesseract.js-core',nome),resolve(destino,nome));
await copyFile('node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz',resolve(destino,'por.traineddata.gz'));
console.log('OCR: worker, motor e português preparados no próprio aplicativo.');
