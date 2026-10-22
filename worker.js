// === 在此处配置您的分发路由表（支持多别名映射） ===
// === 在此处配置您的分发路由表（支持多别名映射） ===
const ROUTING_TABLE = [
  {
    // 示例：机器人 A
    keywords: ["your_email1@example.com", "alias1@yourdomain.com"],
    token: "YOUR_BOT_TOKEN_1",
    chatId: "YOUR_CHAT_ID_1"
  },
  {
    // 示例：机器人 B
    keywords: ["your_email2@example.com", "alias2@yourdomain.com"],
    token: "YOUR_BOT_TOKEN_2",
    chatId: "YOUR_CHAT_ID_2"
  }
];


export default {
  // === 1. 网页前端：从 R2 提取并渲染 Telegram Web App UI ===
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (key && env.R2_BUCKET) {
      const object = await env.R2_BUCKET.get(key);
      if (object) {
        const emailDataStr = await object.text();
        const safeJsonStr = emailDataStr.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
        return new Response(generateWebAppHtml(safeJsonStr), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    }
    return new Response("邮件不存在或已被删除。", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },

  // === 2. 实时收信与智能分发 ===
  async email(message, env, ctx) {
    try {
      const from = message.headers.get("From") || message.from;
      let to = message.headers.get("To") || message.to;
      let subject = message.headers.get("Subject") || "(无主题)";
      subject = decodeHeader(subject);

      let botToken = env.TG_BOT_TOKEN;
      let chatId = env.TG_CHAT_ID;
      let isMatched = false;

      // 仅扫描表层信封，防止历史转发截胡
      const checkQueue = [
        message.to || "",                                            
        message.headers.get("To") || "",                             
        message.headers.get("Cc") || "",                             
        message.headers.get("X-MS-Exchange-Inbox-Rules-Loop") || "", 
        message.from || "",                                          
        message.headers.get("From") || ""                            
      ];

      for (let fieldStr of checkQueue) {
        fieldStr = fieldStr.toLowerCase();
        if (!fieldStr) continue;
        for (const config of ROUTING_TABLE) {
          for (const keyword of config.keywords) {
            if (fieldStr.includes(keyword.toLowerCase())) {
              botToken = config.token; chatId = config.chatId; isMatched = true; break; 
            }
          }
          if (isMatched) break;
        }
        if (isMatched) break; 
      }

      if (!botToken || !chatId) return;
      
      const rawEmail = await new Response(message.raw).text();
      const parsedContent = extractEmailContent(rawEmail);
      
      let webAppUrl = '';
      if (env.R2_BUCKET && env.WORKER_URL) {
        const uuid = crypto.randomUUID();
        const emailData = JSON.stringify({ from: from, to: to, subject: subject, text: parsedContent.text, html: parsedContent.rawHtml || parsedContent.text });
        await env.R2_BUCKET.put(uuid, emailData);
        webAppUrl = env.WORKER_URL.replace(/\/$/, '') + '/' + uuid;
      }

      let bodyPreview = parsedContent.text.replace(/[ \t\xA0]+/g, ' ').replace(/(\r?\n\s*){3,}/g, '\n\n').trim();
      if (bodyPreview.length > 2000) bodyPreview = bodyPreview.substring(0, 2000) + '\n\n...(内容过长已截断)';

      const textMsg = "📬 <b>收到新邮件</b>\n\n" +
                      "<b>收件:</b> " + escapeHtml(to.replace(/<[^>]+>/g, '').trim()) + "\n" +
                      "<b>发件:</b> " + escapeHtml(from) + "\n" +
                      "<b>主题:</b> " + escapeHtml(subject) + "\n\n" +
                      "<b>预览:</b>\n<blockquote>" + escapeHtml(bodyPreview) + "</blockquote>";

      const payload = {
        chat_id: chatId, text: textMsg, parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: webAppUrl ? { inline_keyboard: [[{ text: "📱 在小程序中查看并翻译", web_app: { url: webAppUrl } }]] } : undefined
      };

      let response = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!response.ok) {
        payload.parse_mode = ''; payload.text = textMsg.replace(/<[^>]+>/g, ''); 
        await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }

      for (let i = 0; i < parsedContent.images.length; i++) {
        const img = parsedContent.images[i];
        try {
          const cleanBase64 = img.base64.replace(/[^A-Za-z0-9+/=]/g, '');
          const bytes = new Uint8Array(atob(cleanBase64).split('').map(c => c.charCodeAt(0)));
          const imgFile = new File([bytes], "image_" + i + "." + img.type, { type: 'image/' + img.type });
          const formData = new FormData();
          formData.append('chat_id', chatId); formData.append('photo', imgFile);
          await fetch("https://api.telegram.org/bot" + botToken + "/sendPhoto", { method: 'POST', body: formData });
        } catch (err) {}
      }
    } catch (error) { console.error('处理错误:', error); }
  }
};

// === 3. 前端 UI 生成器 ===
function generateWebAppHtml(jsonDataStr) {
  let html = "<!DOCTYPE html>\n<html lang=\"zh\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">\n  <script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n  <style>\n    :root { --bg-color: var(--tg-theme-bg-color, #ffffff); --text-color: var(--tg-theme-text-color, #000000); --hint-color: var(--tg-theme-hint-color, #999999); --secondary-bg: var(--tg-theme-secondary-bg-color, #f4f4f5); }\n    body { font-family: -apple-system, sans-serif; background: var(--bg-color); color: var(--text-color); margin: 0; display: flex; flex-direction: column; height: 100vh; }\n    .header { padding: 16px; border-bottom: 1px solid var(--secondary-bg); flex-shrink: 0; position: relative; }\n    .header h3 { margin: 0 0 8px 0; font-size: 18px; padding-right: 40px; }\n    .header p { margin: 0; font-size: 14px; color: var(--hint-color); word-break: break-all; }\n    .translate-wrap { padding: 8px 16px 0 16px; flex-shrink: 0; }\n    .tabs { display: flex; background: var(--secondary-bg); margin: 8px 16px 12px 16px; border-radius: 8px; padding: 3px; flex-shrink: 0; }\n    .tab { flex: 1; text-align: center; padding: 8px 0; font-size: 14px; font-weight: 500; cursor: pointer; border-radius: 6px; }\n    .tab.active { background: var(--bg-color); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n    .content-container { flex: 1; position: relative; overflow: hidden; display: flex; flex-direction: column; }\n    .view-panel { position: absolute; top: 0; left: 0; right: 0; bottom: 0; padding: 0 16px 16px 16px; overflow-y: auto; display: none; }\n    .view-panel.active { display: block; }\n    iframe { width: 100%; height: 100%; border: none; }\n    pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 15px; margin: 0; }\n    .goog-te-banner-frame { display: none !important; } body { top: 0px !important; }\n    img { max-width: 100%; height: auto; }\n  </style>\n</head>\n<body>\n  <div class=\"header\"><h3 id=\"ui-subject\">加载中...</h3><p id=\"ui-from\"></p></div>\n  <div class=\"translate-wrap\"><div id=\"google_translate_element\"></div></div>\n  <div class=\"tabs\"><div class=\"tab\" id=\"tab-text\" onclick=\"switchTab('text')\">Plain Text</div><div class=\"tab active\" id=\"tab-html\" onclick=\"switchTab('html')\">HTML</div></div>\n  <div class=\"content-container\"><div class=\"view-panel\" id=\"view-text\"><pre id=\"content-text\"></pre></div><div class=\"view-panel active\" id=\"view-html\"><iframe id=\"content-html\"></iframe></div></div>\n  <script type=\"text/javascript\">function googleTranslateElementInit() { new google.translate.TranslateElement({pageLanguage: 'auto', layout: google.translate.TranslateElement.InlineLayout.SIMPLE}, 'google_translate_element'); }</script>\n  <script type=\"text/javascript\" src=\"https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit\"></script>\n  <script>\n    window.Telegram.WebApp.ready(); window.Telegram.WebApp.expand();\n    const emailData = " + jsonDataStr + ";\n    document.getElementById('ui-subject').innerText = emailData.subject;\n    document.getElementById('ui-from').innerText = '发件人: ' + emailData.from;\n    document.getElementById('content-text').innerText = emailData.text;\n    const translateScript = `<div id=\"google_translate_element\" style=\"margin-bottom:10px;\"></div><script type=\"text/javascript\">function googleTranslateElementInit() {new google.translate.TranslateElement({pageLanguage: 'auto', layout: google.translate.TranslateElement.InlineLayout.SIMPLE}, 'google_translate_element');}<\\/script><script type=\"text/javascript\" src=\"https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit\"><\\/script><style>.goog-te-banner-frame{display:none !important;}body{top:0px !important;} img{max-width:100%;height:auto;}</style>`;\n    let iframeHtml = emailData.html;\n    if (/<body[^>]*>/i.test(iframeHtml)) iframeHtml = iframeHtml.replace(/(<body[^>]*>)/i, '$1' + translateScript);\n    else iframeHtml = translateScript + iframeHtml;\n    document.getElementById('content-html').srcdoc = iframeHtml;\n    function switchTab(type) {\n      document.getElementById('tab-text').classList.remove('active'); document.getElementById('tab-html').classList.remove('active');\n      document.getElementById('view-text').classList.remove('active'); document.getElementById('view-html').classList.remove('active');\n      document.getElementById('tab-' + type).classList.add('active'); document.getElementById('view-' + type).classList.add('active');\n    }\n    if (emailData.html === emailData.text) { switchTab('text'); document.getElementById('tab-html').style.display = 'none'; }\n  </script>\n</body>\n</html>";
  return html;
}

// === 4. 核心解析辅助函数 ===
function getCharset(headerStr) {
  const match = headerStr.match(/charset=["']?([^"';\s]+)["']?/i);
  return match ? match[1].toLowerCase() : 'utf-8';
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractEmailContent(rawEmail) {
  const parts = rawEmail.split(/(?:\r?\n|^)--/);
  let plainText = null, htmlText = null, rawHtmlForFile = null, images = [];
  
  for (let part of parts) {
    part = part.trim(); if (!part) continue;
    const headerEnd = part.search(/\r?\n\r?\n|\n\n/); if (headerEnd === -1) continue;
    const headerBlock = part.substring(0, headerEnd); const bodyBlock = part.substring(headerEnd).trim();
    if (!bodyBlock) continue;
    
    let isImage = false, imgExt = 'png', imgCid = null, imgName = null;
    const typeMatch = headerBlock.match(/Content-Type:\s*([^;\s]+)/i); 
    const nameMatch = headerBlock.match(/name="?([^"]+\.(png|jpe?g|gif|bmp|webp))"?/i);
    const cidMatch = headerBlock.match(/Content-ID:\s*<([^>]+)>/i);
    
    if (typeMatch && typeMatch[1].toLowerCase().startsWith('image/')) { isImage = true; imgExt = typeMatch[1].split('/')[1].replace(/[^a-z0-9]/g, ''); } 
    else if (nameMatch) { isImage = true; imgExt = nameMatch[2].toLowerCase(); imgName = nameMatch[1]; }
    
    if (cidMatch) imgCid = cidMatch[1];
    
    if (isImage) { 
      if (/base64/i.test(headerBlock) && images.length < 5) {
        images.push({ type: imgExt, base64: bodyBlock, cid: imgCid, name: imgName }); 
      }
      continue; 
    }
    
    if (/Content-Type:\s*text\/plain/i.test(headerBlock)) { let decoded = decodeBlock(headerBlock, bodyBlock); if (!plainText) plainText = decoded; }
    if (/Content-Type:\s*text\/html/i.test(headerBlock)) {
      let decoded = decodeBlock(headerBlock, bodyBlock);
      if (!rawHtmlForFile) rawHtmlForFile = "<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" + decoded;
      decoded = decoded.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/h[1-6]>/gi, '\n').replace(/<[^>]+>/g, ' '); 
      if (!htmlText) htmlText = decoded;
    }
  }
  
  let finalBody = htmlText || plainText;
  if (!finalBody && parts.length <= 1) {
    const headerEnd = rawEmail.search(/\r?\n\r?\n|\n\n/);
    if (headerEnd !== -1) { 
      finalBody = decodeBlock(rawEmail.substring(0, headerEnd), rawEmail.substring(headerEnd).trim()); 
      if (/<html|<body|<div/i.test(finalBody)) rawHtmlForFile = "<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" + finalBody; 
    } else {
      finalBody = rawEmail;
    }
  }

  // 转换 HTML 特殊实体字符
  if (finalBody) {
    finalBody = finalBody.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&#160;/g, ' ');
  }

  // 将图片内嵌至 HTML
  if (rawHtmlForFile && images.length > 0) {
    for (let img of images) {
      let cleanBase64 = img.base64.replace(/[^A-Za-z0-9+/=]/g, '');
      let dataUri = `data:image/${img.type};base64,${cleanBase64}`;
      if (img.cid) rawHtmlForFile = rawHtmlForFile.replace(new RegExp(`src=["']?cid:${escapeRegExp(img.cid)}["']?`, 'gi'), `src="${dataUri}"`);
      if (img.name) rawHtmlForFile = rawHtmlForFile.replace(new RegExp(`src=["']?(cid:)?${escapeRegExp(img.name)}["']?`, 'gi'), `src="${dataUri}"`);
    }
  }

  return { text: finalBody || "提取文字为空", images: images, rawHtml: rawHtmlForFile };
}

function decodeBlock(headerBlock, bodyBlock) {
  const charset = getCharset(headerBlock);
  if (/Content-Transfer-Encoding:\s*base64/i.test(headerBlock)) return decodeBase64(bodyBlock.replace(/[^A-Za-z0-9+/=]/g, ''), charset);
  else if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headerBlock)) return decodeQuotedPrintable(bodyBlock, charset);
  return bodyBlock; 
}

function decodeBase64(b, charset = 'utf-8') { 
  try { 
    const bytes = new Uint8Array(atob(b).split('').map(c=>c.charCodeAt(0)));
    try { return new TextDecoder(charset).decode(bytes); } catch(e) { return new TextDecoder('utf-8').decode(bytes); }
  } catch(e) { return "[解密失败]"; } 
}

function decodeQuotedPrintable(q, charset = 'utf-8') { 
  try { 
    const c = q.replace(/=[ \t]*(?:\r?\n|$)/g, ''); const a = []; 
    for (let i = 0; i < c.length; i++) { 
      if (c[i] === '=' && i + 2 < c.length) { 
        const hex = c.substring(i + 1, i + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) { a.push(parseInt(hex, 16)); i += 2; } else a.push(c.charCodeAt(i));
      } else a.push(c.charCodeAt(i)); 
    } 
    const bytes = new Uint8Array(a);
    try { return new TextDecoder(charset).decode(bytes); } catch(e) { return new TextDecoder('utf-8').decode(bytes); }
  } catch(e) { return q; } 
}

function decodeHeader(h) { 
  return h.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, function(m, c, e, t) { 
    const charset = c.toLowerCase();
    if (e.toUpperCase() === 'B') return decodeBase64(t.replace(/[^A-Za-z0-9+/=]/g, ''), charset); 
    else if (e.toUpperCase() === 'Q') return decodeQuotedPrintable(t.replace(/_/g, '=20'), charset); 
    return t; 
  }); 
}

function escapeHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }