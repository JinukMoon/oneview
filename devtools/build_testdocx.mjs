import { zipSync, strToU8 } from 'fflate';
import fs from 'fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function cell(t, bold) {
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r></w:p></w:tc>`;
}
function row(cells, bold) { return `<w:tr>${cells.map((c) => cell(c, bold)).join('')}</w:tr>`; }

const borders = `<w:tblBorders>
<w:top w:val="single" w:sz="6" w:color="444444"/><w:left w:val="single" w:sz="6" w:color="444444"/>
<w:bottom w:val="single" w:sz="6" w:color="444444"/><w:right w:val="single" w:sz="6" w:color="444444"/>
<w:insideH w:val="single" w:sz="6" w:color="888888"/><w:insideV w:val="single" w:sz="6" w:color="888888"/>
</w:tblBorders>`;

const table = `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/>${borders}</w:tblPr>
${row(['항목', '2026', '2027', '비고'], true)}
${row(['예산(백만원)', '120', '150', '증액'], false)}
${row(['인력(명)', '5', '7', '신규 2명'], false)}
${row(['목표 효율(%)', '12.3', '18.7', '↑'], false)}
</w:tbl>`;

const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr><w:t>OneView 표·서식 렌더 테스트</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">아래는 </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>굵은 글씨</w:t></w:r><w:r><w:t xml:space="preserve">와 </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>기울임</w:t></w:r><w:r><w:t>, 그리고 테두리가 있는 표입니다.</w:t></w:r></w:p>
<w:p/>
${table}
<w:p/>
<w:p><w:r><w:t>• 첫 번째 항목</w:t></w:r></w:p>
<w:p><w:r><w:t>• 두 번째 항목 (들여쓰기/목록 느낌)</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>형광펜 강조 텍스트</w:t></w:r></w:p>
</w:body></w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const zip = zipSync({
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rels),
  'word/document.xml': strToU8(doc),
});
fs.writeFileSync('www/_testfiles/ttable.docx', zip);
console.log('wrote www/_testfiles/ttable.docx', zip.length, 'bytes');
