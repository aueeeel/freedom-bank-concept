import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',import.meta.url).href;
export async function readPdf(buffer:ArrayBuffer){
 const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false});const pdf=await task.promise;let text='';
 try{if(pdf.numPages>100)throw Error('Поддерживаются PDF до 100 страниц.');for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();text+=content.items.map((item:any)=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n';if(text.length>2_000_000)throw Error('Слишком большой объём текста. Разделите файл.');}}finally{await task.destroy();}
 if(!text.trim())throw Error('В PDF нет текстового слоя. Для скана потребуется OCR; пока загрузите TXT или JSON.');return text;
}
