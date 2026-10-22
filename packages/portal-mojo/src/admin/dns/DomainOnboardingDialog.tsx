import { modal } from '../../ui';
import { DomainOnboardingDialog, type OnboardingMode } from './DomainOnboardingContent';

/** No-argument callers retain the original menu. */
export function showDomainOnboarding({ initialMode = 'menu' }: { initialMode?: OnboardingMode } = {}): Promise<unknown> {
    let busy = false;
    return modal.open((close) => <DomainOnboardingDialog initialMode={initialMode} close={() => close(null)} setBusyGate={(value) => { busy = value; }} />, { size: 'lg', canDismiss: () => !busy });
}
