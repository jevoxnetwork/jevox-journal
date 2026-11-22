export const manualMarkupPrefix = '<!--jevox-manual-v2-->';

const tags = new Set(['P','DIV','BR','H2','H3','H4','BLOCKQUOTE','HR','B','STRONG','I','EM','U','S','STRIKE','DEL','UL','OL','LI','A','IMG','CODE','PRE']);
const alignments = new Set(['left','center','right','justify']);
const imageSource = /^(?:data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+|\/api\/manual-images\/[a-f0-9-]{36})$/;

export function manualLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function cleanManualHTML(root) {
  const clean = document.createElement('div');
  function append(source, target) {
    if (source.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(source.nodeValue));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE || source.namespaceURI !== 'http://www.w3.org/1999/xhtml' || ['SCRIPT','STYLE','IFRAME','SVG','MATH'].includes(source.tagName)) return;
    const node = tags.has(source.tagName) ? document.createElement(source.tagName) : null;
    if (source.tagName === 'IMG') {
      const src = source.getAttribute('data-journal-image') || source.getAttribute('src') || '';
      if (!imageSource.test(src)) return;
      node.setAttribute('src', src);
      node.alt = 'Фото из мануала';
      node.loading = 'lazy';
      node.draggable = true;
      if (source.dataset.width) {
        const width = Math.max(15, Math.min(100, Number(source.dataset.width) || 100));
        node.dataset.width = String(width);
        node.style.width = width + '%';
      }
    }
    if (source.tagName === 'A') {
      const href = manualLink(source.getAttribute('href'));
      if (href) {
        node.setAttribute('href', href);
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
    }
    if (node && ['P','DIV','H2','H3','H4','BLOCKQUOTE','UL','OL','LI','IMG'].includes(source.tagName)) {
      const alignment = source.style.textAlign || source.getAttribute('align') || source.dataset.align;
      if (alignments.has(alignment)) node.dataset.align = alignment;
    }
    if (node) target.append(node);
    for (const child of source.childNodes) append(child, node || target);
  }
  for (const child of root.childNodes) append(child, clean);
  return clean.innerHTML;
}

export function readFormattedManual(content) {
  const template = document.createElement('template');
  template.innerHTML = content.slice(manualMarkupPrefix.length);
  return cleanManualHTML(template.content);
}

export function saveFormattedManual(root) {
  const html = cleanManualHTML(root);
  if (!root.textContent.trim() && !/<img |<hr>/.test(html)) return '';
  return manualMarkupPrefix + html;
}
