import { useState } from 'react';
import { BackendsPage, BucketsPage, FilesPage, showBucketDetail, showFileView } from 'portal-mojo/admin/infrastructure';

type Surface = 'buckets' | 'backends' | 'files' | 'modals';

export function AdminStorageDemo() {
    const [surface, setSurface] = useState<Surface>('buckets');
    return <div className="flex flex-col gap-3">
        <div className="panel panel-pad"><div className="eyebrow">Global Admin · no group context</div><h2 className="panel-title">Storage control plane</h2><p className="dim">One live-shaped mock owns the S3 inventory, masked backends, policy-backed uploads, files, renditions, and visible shares. Open Files to exercise Add File, whole-page drop, local/provider progress, cancel, retry, and authoritative refresh.</p><div className="seg-row"><div className="seg">{(['buckets', 'backends', 'files', 'modals'] as Surface[]).map((key) => <button key={key} className={`seg-btn${surface === key ? ' seg-active' : ''}`} onClick={() => setSurface(key)}>{key[0]!.toUpperCase() + key.slice(1)}</button>)}</div></div></div>
        {surface === 'buckets' && <BucketsPage />}
        {surface === 'backends' && <BackendsPage />}
        {surface === 'files' && <FilesPage />}
        {surface === 'modals' && <div className="panel panel-pad"><h3>KISS modal evidence</h3><p className="dim">Open a native detail modal, then safely cancel the armed/exact-name empty flow or exercise media playback. The audio/video element keeps its captured source through ordinary query refreshes.</p><div className="storage-action-row"><button className="btn" onClick={() => showBucketDetail({ id: 'mojo-private-assets', name: 'mojo-private-assets', created: 1746000000 })}><i className="bi bi-bucket" /> Bucket empty confirmation</button><button className="btn" onClick={() => showFileView(5102)}><i className="bi bi-play-btn" /> Playable video</button><button className="btn" onClick={() => showFileView(5103)}><i className="bi bi-music-note-beamed" /> Playable audio</button><button className="btn" onClick={() => showFileView(5105)}><i className="bi bi-shield-exclamation" /> Unsafe URL refusal</button><button className="btn" onClick={() => showFileView(5106)}><i className="bi bi-images" /> Initial rendition arrival</button></div></div>}
    </div>;
}
