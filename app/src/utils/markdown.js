// 极简 Markdown 渲染器（AI 诊断/日志分析报告预览专用）。
// 安全模型：转义优先 —— 全文先做 HTML 实体转义，再在其上套用 Markdown 转换，
// 因此模型输出中的任何 HTML/JS 都只会作为纯文本显示，XSS 由构造保证。
// 支持 GFM 常用子集：标题 / 加粗 / 斜体 / 行内代码 / 围栏代码块 / 无序与有序列表 /
// 引用 / 表格 / 链接（仅放行 http(s)/mailto）/ 分割线 / 段落。

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])
}

// 行内元素：输入必须是已转义的文本
function renderInline(escaped) {
  let out = escaped
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
    /^(https?:|mailto:)/i.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : text)
  return out
}

export function renderMarkdown(src) {
  const lines = escapeHtml(String(src || '').replace(/\r\n?/g, '\n')).split('\n')
  const html = []
  let i = 0
  let listTag = null
  let para = []
  const closeList = () => { if (listTag) { html.push(`</${listTag}>`); listTag = null } }
  const closePara = () => { if (para.length) { html.push(`<p>${para.map(renderInline).join('<br>')}</p>`); para = [] } }
  const splitRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => renderInline(c.trim()))

  while (i < lines.length) {
    const line = lines[i]

    if (/^```/.test(line)) { // 围栏代码块
      closePara(); closeList()
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      html.push(`<pre><code>${buf.join('\n')}</code></pre>`)
      continue
    }
    if (!line.trim()) { closePara(); closeList(); i++; continue }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { // 标题
      closePara(); closeList()
      html.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`)
      i++; continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { // 分割线
      closePara(); closeList()
      html.push('<hr>')
      i++; continue
    }
    // 表格：当前行含 |，下一行是分隔行（| --- | --- |）
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      closePara(); closeList()
      const head = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++ }
      html.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^&gt;\s?/.test(line)) { // 引用（> 已被转义为 &gt;）
      closePara(); closeList()
      const buf = []
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''))
      html.push(`<blockquote><p>${buf.map(renderInline).join('<br>')}</p></blockquote>`)
      continue
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d{1,3}[.、)]\s+(.*)$/)
    if (ul || ol) { // 列表
      closePara()
      const tag = ul ? 'ul' : 'ol'
      if (listTag !== tag) { closeList(); html.push(`<${tag}>`); listTag = tag }
      html.push(`<li>${renderInline((ul || ol)[1])}</li>`)
      i++; continue
    }

    closeList()
    para.push(line)
    i++
  }
  closePara(); closeList()
  return html.join('\n')
}
