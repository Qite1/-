'use strict';
// 纯 Node 实现的 .xlsx 写入器（零依赖）
// 结构：ZIP(STORE 或 DEFLATE) 内含多个 XML 工作表 + 共享样式等。
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 最小 ZIP 构建器
function buildZip(entries) {
  // entries: [{name, data(Buffer), method: 0|8}]
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const method = e.method || 8;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10); // time
    lfh.writeUInt16LE(0, 12); // date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    localParts.push(lfh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8); // flags
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); // time
    ch.writeUInt16LE(0, 14); // date
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    centralParts.push(ch, nameBuf);

    offset += lfh.length + nameBuf.length + comp.length;
  }

  const centralStart = Buffer.concat(localParts).length;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(idx) {
  let n = idx; // 0-based
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// 生成工作表 XML
function sheetXml(rows, colWidths, opts = {}) {
  // rows: 二维数组；opts = {headerFill, headerFontColor}
  const { headerFill = 'FF2E5A88', headerFontColor = 'FFFFFFFF' } = opts;
  const sheet = {
    cols: colWidths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join(''),
    rows: rows
      .map((r, ri) => {
        return (
          `<row r="${ri + 1}">` +
          r
            .map((c, ci) => {
              const ref = `${colName(ci)}${ri + 1}`;
              if (ri === 0) {
                return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(c)}</t></is></c>`;
              }
              if (typeof c === 'number') {
                return `<c r="${ref}" s="2"><v>${c}</v></c>`;
              }
              const v = xmlEscape(c == null ? '' : String(c));
              // 风险等级列固定 D 列(索引3)做颜色
              const style = ci === 3 ? ` style="${c === '重大' ? 3 : c === '较大' ? 4 : c === '一般' ? 5 : 2}"` : ' s="2"';
              return `<c r="${ref}" t="inlineStr"${style}><is><t>${v}</t></is></c>`;
            })
            .join('') +
          `</row>`
        );
      })
      .join(''),
  };
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${sheet.cols}</cols><sheetData>${sheet.rows}</sheetData></worksheet>`
  );
}

const sharedStrings = [];
function addSharedString(s) {
  const idx = sharedStrings.indexOf(s);
  if (idx >= 0) return idx;
  sharedStrings.push(s);
  return sharedStrings.length - 1;
}

// 通用生成：可含多个 sheet
function buildWorkbook(sheets, meta = {}) {
  sharedStrings.length = 0;
  const entries = [];
  const wbStyleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="微软雅黑"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="2E5A88"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><font><color rgb="FFC00000"/></font></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><font><color rgb="FFED7D31"/></font></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><font><color rgb="FFFFC000"/></font></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
${sheets.map((s, i) => `<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/stylesheet" Target="styles.xml"/><Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name || `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 2}"/>`).join('')}</sheets>
</workbook>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetRels = sheets.map((s, i) => {
    return {
      name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/stylesheet" Target="../styles.xml"/>
</Relationships>`,
        'utf8'
      ),
      method: 8,
    };
  });

  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>水利工程质量安全合规管理助手</dc:creator>
<dc:title>${xmlEscape(meta.title || '')}</dc:title>
</cp:coreProperties>`;

  const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>WaterSafetyAssistant</Application></Properties>`;

  entries.push({ name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8'), method: 8 });
  entries.push({ name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8'), method: 8 });
  entries.push({ name: 'docProps/core.xml', data: Buffer.from(coreProps, 'utf8'), method: 8 });
  entries.push({ name: 'docProps/app.xml', data: Buffer.from(appProps, 'utf8'), method: 8 });
  entries.push({ name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8'), method: 8 });
  entries.push({ name: 'xl/styles.xml', data: Buffer.from(wbStyleXml, 'utf8'), method: 8 });

  sheets.forEach((s, i) => {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(s.rows, s.colWidths), 'utf8'),
      method: 8,
    });
  });
  sheetRels.forEach((r) => entries.push(r));
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8'), method: 8 });

  return buildZip(entries);
}

module.exports = { buildWorkbook, xmlEscape };