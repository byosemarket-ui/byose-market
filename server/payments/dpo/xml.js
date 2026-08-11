/**
 * Lightweight XML helpers for DPO Pay API payloads.
 * Avoids adding an XML dependency for simple tag extract/build.
 */

function escapeXml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function extractTag(xml, tagName) {
    const name = String(tagName || '').trim();
    if (!name || !xml) return '';
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const match = String(xml).match(pattern);
    if (!match) return '';
    return String(match[1] || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .trim();
}

function redactXmlSecrets(xml) {
    return String(xml || '')
        .replace(/<CompanyToken>([\s\S]*?)<\/CompanyToken>/gi, '<CompanyToken>[redacted]</CompanyToken>')
        .replace(/<TransactionToken>([\s\S]*?)<\/TransactionToken>/gi, (full, inner) => {
            const token = String(inner || '').trim();
            if (!token) return '<TransactionToken></TransactionToken>';
            const hint = token.length > 4 ? `••••${token.slice(-4)}` : '••••';
            return `<TransactionToken>${hint}</TransactionToken>`;
        })
        .replace(/<TransToken>([\s\S]*?)<\/TransToken>/gi, (full, inner) => {
            const token = String(inner || '').trim();
            if (!token) return '<TransToken></TransToken>';
            const hint = token.length > 4 ? `••••${token.slice(-4)}` : '••••';
            return `<TransToken>${hint}</TransToken>`;
        });
}

module.exports = {
    escapeXml,
    extractTag,
    redactXmlSecrets
};
