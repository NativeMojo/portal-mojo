import { useState } from 'react';
import { ShortlinkHistoryPage, ShortlinksPage, showShortlinkDetail } from 'portal-mojo/admin';

export function AdminShortlinksDemo() {
    const [surface, setSurface] = useState<'links' | 'history' | 'detail'>('links');
    return <div className="flex flex-col gap-3"><div className="panel panel-pad"><div className="eyebrow">Global Admin · no group context</div><h2 className="panel-title">Shortlink operations</h2><p className="dim">Destination-free cached rows, bounded click summaries, functional API-origin links, and reconciled non-retrying mutations.</p><div className="seg-row"><div className="seg">{(['links', 'history', 'detail'] as const).map((key) => <button key={key} className={`seg-btn${surface === key ? ' seg-active' : ''}`} onClick={() => { setSurface(key); if (key === 'detail') showShortlinkDetail(9101); }}>{key[0].toUpperCase() + key.slice(1)}</button>)}</div></div></div>{surface === 'links' && <ShortlinksPage />}{surface === 'history' && <ShortlinkHistoryPage />}{surface === 'detail' && <div className="panel panel-pad"><p className="dim">The KISS detail opened as a native dialog. Close it to continue.</p></div>}</div>;
}
