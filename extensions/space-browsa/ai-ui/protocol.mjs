export const MAX_UI_CHARS = 64000;
export const hasUiProgram = html => /<script\b[^>]*\btype\s*=\s*(["'])application\/space-ui\+json\1[^>]*>/i.test(html) || /<meta\b[^>]*\bname\s*=\s*(["'])space-tool\1[^>]*>/i.test(html) || /\bspaceTool\s*\.\s*(?:loadState|saveState|setResult)\s*\(/.test(html);
export function isLegacyUi(html) {
  if (/<script\b[^>]*type\s*=\s*(["'])application\/space-ui\+json\1/i.test(html)) return true;
  return /\bdata-ui-action\s*=/.test(html) && !/\bspaceTool\s*\./.test(html) && !/<meta\b[^>]*\bname\s*=\s*(["'])space-tool\1/i.test(html);
}
// An explicit fence or typed data program opts in; ordinary HTML stays code.
function answerOnly(text) {
  const tokens=/^ {0,3}(`{3,}|~{3,})([^\n]*)$|<(\/?)(think|thinking|antml:thinking)(?=[\s>])[^>]*>/gim;
  const thinking=[], visible=[];
  let fence=null, reasoningFence=null, start=0;
  for(const token of text.matchAll(tokens)) {
    if(token[1]) {
      if(thinking.length) {
        if(!reasoningFence)reasoningFence=token[1];
        else if(token[1][0]===reasoningFence[0] && token[1].length>=reasoningFence.length && !token[2].trim())reasoningFence=null;
        continue;
      }
      if(!fence)fence=token[1];
      else if(token[1][0]===fence[0] && token[1].length>=fence.length && !token[2].trim())fence=null;
    } else if(!fence) {
      const tag=token[4].toLowerCase();
      if(thinking.length && reasoningFence) {
        const lineStart=text.lastIndexOf('\n',token.index-1)+1;
        const lineEnd=text.indexOf('\n',token.index+token[0].length);
        const line=text.slice(lineStart,lineEnd<0?text.length:lineEnd).trim();
        // The transport closes its wrapper on a separate line even when a
        // reasoning draft left a code fence unfinished. Strings stay literal.
        if(!token[3] || thinking.at(-1)!==tag || line!==token[0])continue;
      }
      if(!token[3]) {
        if(!thinking.length)visible.push(text.slice(start,token.index),'\n');
        thinking.push(tag);
      } else if(thinking.at(-1)===tag) {
        thinking.pop();
        if(!thinking.length){start=token.index+token[0].length;reasoningFence=null;}
      }
    }
  }
  if(!thinking.length)visible.push(text.slice(start));
  return visible.join('');
}
export function parseUi(text) {
  if (typeof text !== 'string') return { state: 'none' };
  if (/\_\(cancelled\)\_\s*$/.test(text)) return { state: 'none' };
  text=answerOnly(text);
  let fence = null, ui = false, htmlFence = false, lines = [], found = null;
  for (const line of text.split('\n')) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && match) {
      fence = match[1]; ui = match[2].trim() === 'space-ui'; htmlFence = match[2].trim().toLowerCase() === 'html'; lines = [];
    } else if (fence && match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
      const html = lines.join('\n');
      if (ui || (htmlFence && hasUiProgram(html))) {
        if (found) return { state: 'error', message: '每条消息只支持一个 AI UI。' };
        if (!html.trim() || html.length > MAX_UI_CHARS) return { state: 'error', message: 'AI UI 为空或超过 64,000 字符，请重新生成。' };
        found = { state: 'ready', html };
      }
      fence = null; ui = false; htmlFence = false;
    } else if (fence && (ui || htmlFence)) lines.push(line);
  }
  if (ui || (htmlFence && hasUiProgram(lines.join('\n')))) return { state: 'pending' };
  // Interrupted responses must not become executable previews on history reload.
  return found || { state: 'none' };
}

export function isUiBlocked(message = {}) {
  return message.interrupted === true || message.outputTruncated === true;
}
