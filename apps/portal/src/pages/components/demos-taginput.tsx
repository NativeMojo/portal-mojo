// TagInput demos — every branch of the port in one place: the keyboard flow,
// the maxTags cap, duplicate rejection, a custom separator, readonly and
// disabled. Each panel prints the CSV string the component emits, because THAT
// string (not the array) is what django-mojo stores and re-splits.
import { useState } from 'react';
import { TagInput } from 'portal-mojo/ui';

/** The parent side of the contract: hold the CSV, keep the array if handy. */
function useTagState(initial: string, separator = ',') {
    const [csv, setCsv] = useState(initial);
    const [tags, setTags] = useState<string[]>(() => initial.split(separator).filter(Boolean));
    return {
        csv,
        tags,
        onChange: (nextCsv: string, nextTags: string[]) => { setCsv(nextCsv); setTags(nextTags); },
    };
}

/** Shows the exact value shape a parent would save. */
function ValueOut({ csv, tags }: { csv: string; tags: string[] }) {
    return (
        <div className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>
            <div>csv (the wire value): <code>{JSON.stringify(csv)}</code></div>
            <div>tags (convenience): <code>{JSON.stringify(tags)}</code></div>
        </div>
    );
}

export function TagInputDemo() {
    const basic = useTagState('javascript,react,node');
    const capped = useTagState('alpha,beta,gamma,delta');
    const dupes = useTagState('design,design-system');
    const dupesOk = useTagState('red,red,blue');
    const piped = useTagState('us-east-1|us-west-2', '|');

    return (
        <>
            <div className="panel panel-pad" style={{ marginBottom: 14 }}>
                <div className="eyebrow">Default</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    Commit with <kbd>Enter</kbd>, <kbd>Tab</kbd> or <kbd>,</kbd> — or paste text ending in a
                    comma. <kbd>Backspace</kbd> on an empty field drops the last chip;{' '}
                    <kbd>←</kbd>/<kbd>→</kbd> walk the chips (Backspace or Delete removes the focused one);{' '}
                    <kbd>Esc</kbd> clears what you have typed. Tab commits <em>and</em> moves on — web-mojo
                    trapped focus in the field instead.
                </p>
                <TagInput name="tags" value={basic.csv} onChange={basic.onChange} />
                <ValueOut csv={basic.csv} tags={basic.tags} />
            </div>

            <div className="panel panel-pad" style={{ marginBottom: 14 }}>
                <div className="eyebrow">maxTags = 5 (the counter is always on)</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    Add a sixth tag: the add is refused and <code>Maximum 5 tags allowed</code> flashes under
                    the field for ~3s. The counter reads <code>n/5 tags</code> throughout.
                </p>
                <TagInput
                    value={capped.csv}
                    onChange={capped.onChange}
                    maxTags={5}
                    placeholder="One more than five…"
                />
                <ValueOut csv={capped.csv} tags={capped.tags} />
            </div>

            <div className="panel panel-pad" style={{ marginBottom: 14 }}>
                <div className="eyebrow">Duplicates</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    Type <code>design</code> again — case-sensitive duplicate check, refused with{' '}
                    <code>Tag "design" already exists</code>. (<code>Design</code> is a different tag.)
                </p>
                <TagInput value={dupes.csv} onChange={dupes.onChange} />
                <ValueOut csv={dupes.csv} tags={dupes.tags} />

                <div className="eyebrow" style={{ marginTop: 18 }}>allowDuplicates</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    With <code>allowDuplicates</code> the same tag may repeat — and repeats survive the CSV
                    round-trip instead of being collapsed on parse.
                </p>
                <TagInput value={dupesOk.csv} onChange={dupesOk.onChange} allowDuplicates />
                <ValueOut csv={dupesOk.csv} tags={dupesOk.tags} />
            </div>

            <div className="panel panel-pad" style={{ marginBottom: 14 }}>
                <div className="eyebrow">Custom separator (<code>|</code>)</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    The separator both joins the value and commits on keypress, so commas are ordinary
                    characters here — try <code>ap-southeast-2, sydney</code> as one tag, then <kbd>|</kbd>.
                </p>
                <TagInput
                    value={piped.csv}
                    onChange={piped.onChange}
                    separator="|"
                    placeholder="Add regions…"
                />
                <ValueOut csv={piped.csv} tags={piped.tags} />
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">readonly / disabled</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    <code>readonly</code> drops the input and the remove icons (chips stay keyboard-navigable
                    for reading); <code>disabled</code> keeps the field but refuses every add and removal.
                </p>
                <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                    <div>
                        <span className="field-label">readonly</span>
                        <TagInput value="prod,us-east-1,pci" readonly />
                    </div>
                    <div>
                        <span className="field-label">disabled</span>
                        <TagInput value="prod,us-east-1,pci" disabled />
                    </div>
                </div>
            </div>
        </>
    );
}
