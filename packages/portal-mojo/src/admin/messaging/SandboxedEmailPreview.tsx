import { useMemo } from 'react';

export const EMAIL_PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; frame-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'";
const DROP_ELEMENTS='script,style,link,base,meta,iframe,frame,frameset,object,embed,form,input,button,textarea,select,option,video,audio,source,track,picture,svg,math,canvas';
const DROP_ATTR=/^(?:on|href$|xlink:href$|src$|srcset$|action$|formaction$|poster$|ping$|background$|data$|codebase$|manifest$)/i;
function escapeHtml(value:string):string{return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}

/** Parse into a fresh detached document, project safe presentation markup, then serialize. */
export function sanitizeEmailHtml(html:string):string{
    if(typeof DOMParser==='undefined')return `<pre>${escapeHtml(html)}</pre>`;
    const parsed=new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`,'text/html');
    parsed.body.querySelectorAll(DROP_ELEMENTS).forEach(node=>node.remove());
    parsed.body.querySelectorAll('*').forEach((element)=>{
        for(const attr of [...element.attributes]){
            const name=attr.name.toLowerCase();
            if(DROP_ATTR.test(name)||name==='xmlns'||name.startsWith('xmlns:')||(name==='style'&&/url\s*\(|@import|expression\s*\(/i.test(attr.value)))element.removeAttribute(attr.name);
        }
        if(element.tagName==='A'){element.removeAttribute('href');element.removeAttribute('target');element.setAttribute('aria-disabled','true');}
    });
    return parsed.body.innerHTML;
}
export function buildEmailPreviewDocument(html:string):string{const body=sanitizeEmailHtml(html);return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${EMAIL_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"></head><body>${body}</body></html>`;}
export function SandboxedEmailPreview({html,text}:{html?:string|null;text?:string|null}){const srcDoc=useMemo(()=>buildEmailPreviewDocument(html??''),[html]);return <div className="email-preview">{text&&<pre className="email-preview-text">{text}</pre>}{html&&<iframe title="Sandboxed email HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc}/>} {!text&&!html&&<p className="dim">No message body.</p>}</div>;}
