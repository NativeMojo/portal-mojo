import { MediaRenderingPage } from 'portal-mojo/admin/infrastructure';

export function AdminMediaRenderingDemo() {
    return <div className="flex flex-col gap-3">
        <div className="panel panel-pad">
            <div className="eyebrow">Global Admin · no group context</div>
            <h2 className="panel-title">Media rendering</h2>
            <p className="dim">
                The three <code>FILEMAN_RENDITIONS_*</code> settings as a form built entirely from the mock&apos;s
                <code> /api/fileman/renditions/options</code> descriptor: one row per rendition role, typed fields clamped
                to the published limits, a &quot;runs on upload&quot; switch, greyed defaults. The mock seeds a video override
                (<code>video_hevc.crf = 24</code>) so a changed field sits beside its defaults; enter <code>crf 99</code> and Save
                to watch the server&apos;s 400 land beside the field, then Reset to defaults to write <code>{'{}'}</code>.
            </p>
        </div>
        <MediaRenderingPage />
    </div>;
}
