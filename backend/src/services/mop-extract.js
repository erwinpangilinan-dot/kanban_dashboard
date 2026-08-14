const path = require('path');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const { PDFParse } = require('pdf-parse');

const MAX_BYTES = 15 * 1024 * 1024;

function slugFromFilename(name) {
  return path
    .basename(name, path.extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turn loose extracted prose into markdown-ish sections when possible. */
function toMarkdownish(text, titleHint) {
  let body = normalizeWhitespace(text);
  if (!body) return '';

  // Promote ALL-CAPS short lines to ## headings (common in MOPs)
  body = body
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (
        t.length >= 4 &&
        t.length <= 80 &&
        /^[A-Z0-9][A-Z0-9\s\-_/().]+$/.test(t) &&
        /[A-Z]/.test(t) &&
        !t.includes('.')
      ) {
        return `\n## ${t.replace(/\s+/g, ' ')}\n`;
      }
      return line;
    })
    .join('\n');

  body = normalizeWhitespace(body);
  if (titleHint && !/^#\s+/m.test(body)) {
    body = `# ${titleHint}\n\n${body}`;
  }
  return body;
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeWhitespace(result?.text || '');
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result.value || '');
}

async function extractDoc(buffer) {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  const parts = [doc.getBody(), doc.getHeaders(), doc.getFooters()].filter(Boolean);
  return normalizeWhitespace(parts.join('\n\n'));
}

async function extractPlain(buffer) {
  return normalizeWhitespace(buffer.toString('utf8'));
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mime]
 */
async function extractMopDocument(buffer, filename, mime = '') {
  if (!buffer?.length) throw new Error('Empty file');
  if (buffer.length > MAX_BYTES) throw new Error('File too large (max 15 MB)');

  const lower = String(filename || '').toLowerCase();
  const mimeL = String(mime || '').toLowerCase();
  let format = 'unknown';
  let text = '';

  if (lower.endsWith('.pdf') || mimeL.includes('pdf')) {
    format = 'pdf';
    text = await extractPdf(buffer);
  } else if (lower.endsWith('.docx') || mimeL.includes('wordprocessingml')) {
    format = 'docx';
    text = await extractDocx(buffer);
  } else if (lower.endsWith('.doc') || mimeL === 'application/msword') {
    format = 'doc';
    text = await extractDoc(buffer);
  } else if (
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    lower.endsWith('.txt') ||
    mimeL.startsWith('text/')
  ) {
    format = lower.endsWith('.txt') ? 'txt' : 'markdown';
    text = await extractPlain(buffer);
  } else {
    throw new Error(
      'Unsupported file type. Use .pdf, .doc, .docx, .md, .markdown, or .txt'
    );
  }

  if (!text || text.length < 20) {
    throw new Error(
      'Could not extract enough text from this file (scanned PDFs need OCR — convert to text/markdown first).'
    );
  }

  const suggested_mop_id = slugFromFilename(filename);
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const suggested_title =
    titleMatch?.[1]?.trim() ||
    path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ').trim();

  const markdown =
    format === 'markdown' || format === 'txt'
      ? text
      : toMarkdownish(text, suggested_title);

  return {
    format,
    filename: path.basename(filename),
    markdown,
    suggested_mop_id,
    suggested_title,
    char_count: markdown.length,
  };
}

module.exports = {
  extractMopDocument,
  MAX_BYTES,
};
