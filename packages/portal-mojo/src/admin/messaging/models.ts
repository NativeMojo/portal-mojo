import { defineModel, type Params } from '../../client';
import {
    sanitizeEmailDomainRow, sanitizeMailboxRow, sanitizePublicMessageRow,
    sanitizeSentMessageRow, sanitizeTemplateRow,
} from './sanitize';

export const EMAIL_ADMIN_PERMISSIONS = ['sys.manage_aws', 'sys.comms'];
export const PUBLIC_MESSAGE_VIEW_PERMISSIONS = ['sys.view_support', 'sys.security', 'sys.support'];
export const PUBLIC_MESSAGE_MANAGE_PERMISSIONS = ['sys.manage_support', 'sys.security', 'sys.support'];
export const PUBLIC_MESSAGE_DELETE_PERMISSIONS = ['sys.manage_support'];

export interface MessagingRelation { id: number; name?: string; email?: string }
export type EmailDomainStatus = 'pending' | 'verified' | 'ready' | 'missing' | 'unknown';
export type EmailDnsMode = 'manual' | 'route53' | 'godaddy' | 'unknown';
export type SentMessageStatus = 'queued' | 'sending' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'unknown';

export interface EmailDomainRow {
    id: number; created: number; modified: number; name: string; region: string; status: EmailDomainStatus;
    receiving_enabled: boolean; s3_inbound_bucket: string | null; s3_inbound_prefix: string; dns_mode: EmailDnsMode;
    aws_key_masked?: string | null; aws_secret_masked?: string | null;
    sns_topic_bounce_arn?: string | null; sns_topic_complaint_arn?: string | null; sns_topic_delivery_arn?: string | null; sns_topic_inbound_arn?: string | null;
}
export interface MailboxRow {
    id: number; created: number; modified: number; email: string; domain: MessagingRelation | number | null;
    allow_inbound: boolean; allow_outbound: boolean; async_handler: string | null;
    is_system_default: boolean; is_domain_default: boolean;
}
export interface SentMessageRow {
    id: number; created: number; modified: number; mailbox: MessagingRelation | number | null;
    to_addresses: string[]; cc_addresses: string[]; bcc_addresses?: string[]; subject: string; status: SentMessageStatus;
    ses_message_id: string | null; status_reason?: string | null; body_text?: string | null; body_html?: string | null;
}
export interface EmailTemplateRow {
    id: number; created: number; modified: number; name: string; subject_template?: string; html_template?: string | null; text_template?: string | null;
}
export interface PublicMessageRow {
    id: number; created: number; modified: number; kind: 'contact_us' | 'support' | string; status: 'open' | 'closed' | string;
    name: string; email: string; subject: string; group: MessagingRelation | number | null;
    message?: string; metadata?: Record<string, string>; metadata_withheld?: boolean; ip_address?: string | null; user_agent?: string | null;
}
export interface EmailDnsRecord { type: string; name: string; value: string; ttl: number }
export interface DomainOnboardInput {
    use_dnsman: boolean; region?: string; receiving_enabled?: boolean; s3_inbound_bucket?: string; s3_inbound_prefix?: string;
    ensure_mail_from?: boolean; mail_from_subdomain?: string; dns_mode?: 'manual';
    endpoints?: { bounce?: string; complaint?: string; delivery?: string; inbound?: string };
}
export interface DomainActionResult {
    domain: string; region: string; status?: string; dns_records: EmailDnsRecord[]; dkim_tokens: string[]; notes: string[];
    provider?: string; applied?: number; topic_arns?: Record<string, string>; receipt_rule?: string; rule_set?: string;
}
export interface DomainAuditResult {
    domain: string; region: string; status: string; audit_pass: boolean; checks: Record<string, boolean>;
    items: Array<{ resource: string; status: string }>;
    recommendations: Array<{ resource: string; severity: string; action: string; explanation: string }>;
}
export interface SendEmailInput {
    from_email: string; to: string[]; cc?: string[]; bcc?: string[]; reply_to?: string;
    subject?: string; body_text?: string; body_html?: string; template_name?: string; template_context?: Record<string, unknown>;
}

const COMMON = new Set(['start', 'size', 'search', 'sort', 'dr_field', 'dr_start', 'dr_end']);
function allow(params: Params, graph: string, filters: readonly string[], sorts:readonly string[], defaultSort: string, dateRange=false): Params {
    const out: Params = { graph, start: params.start ?? 0, size: params.size ?? 25 };
    const allowed = new Set([...COMMON, ...filters]);
    for (const [key, value] of Object.entries(params)) if (allowed.has(key) && value != null && value !== '') out[key] = value;
    const requested=typeof params.sort==='string'?params.sort:'';const field=requested.replace(/^-/,'');
    out.graph = graph; out.sort = sorts.includes(field) ? requested : defaultSort;
    if(dateRange&&(out.dr_start||out.dr_end)){out.dr_field='created';}else{delete out.dr_field;delete out.dr_start;delete out.dr_end;}
    return out;
}

export const EmailDomainModel = defineModel<EmailDomainRow>({ name: 'email-domain', endpoint: '/api/aws/email/domain', permissions: { view: EMAIL_ADMIN_PERMISSIONS, manage: EMAIL_ADMIN_PERMISSIONS, delete: EMAIL_ADMIN_PERMISSIONS }, normalizeListParams: (p) => allow(p, 'default', ['region', 'status', 'receiving_enabled', 'dns_mode'], ['name','region','status','receiving_enabled','dns_mode','created','modified'], 'name'), sanitizeRow: sanitizeEmailDomainRow });
export const MailboxModel = defineModel<MailboxRow>({ name: 'email-mailbox', endpoint: '/api/aws/email/mailbox', permissions: { view: EMAIL_ADMIN_PERMISSIONS, manage: EMAIL_ADMIN_PERMISSIONS, delete: EMAIL_ADMIN_PERMISSIONS }, normalizeListParams: (p) => allow(p, 'default', ['domain', 'allow_inbound', 'allow_outbound', 'is_system_default', 'is_domain_default'], ['email','allow_inbound','allow_outbound','is_system_default','is_domain_default','created','modified'], 'email'), sanitizeRow: sanitizeMailboxRow });
export const SentMessageModel = defineModel<SentMessageRow>({ name: 'sent-message', endpoint: '/api/aws/email/sent', permissions: { view: EMAIL_ADMIN_PERMISSIONS }, normalizeListParams: (p) => allow(p, 'basic', ['mailbox', 'status', 'status__in'], ['created','status','subject','ses_message_id'], '-created',true), sanitizeRow: sanitizeSentMessageRow });
export const EmailTemplateModel = defineModel<EmailTemplateRow>({ name: 'email-template', endpoint: '/api/aws/email/template', permissions: { view: EMAIL_ADMIN_PERMISSIONS, manage: EMAIL_ADMIN_PERMISSIONS, delete: EMAIL_ADMIN_PERMISSIONS }, normalizeListParams: (p) => allow(p, 'basic', [], ['name','created','modified'], 'name',true), sanitizeRow: sanitizeTemplateRow });
export const PublicMessageModel = defineModel<PublicMessageRow>({ name: 'public-message', endpoint: '/api/account/public_message', permissions: { view: PUBLIC_MESSAGE_VIEW_PERMISSIONS, manage: PUBLIC_MESSAGE_MANAGE_PERMISSIONS, delete: PUBLIC_MESSAGE_DELETE_PERMISSIONS }, normalizeListParams: (p) => allow(p, 'list', ['kind', 'kind__in', 'status', 'status__in'], ['created','modified','kind','status','name','email','subject'], '-created',true), sanitizeRow: sanitizePublicMessageRow });
