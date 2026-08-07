import { defineModel, type Params } from '../../client/runtime';

export const PHONE_NUMBER_VIEW_PERMISSIONS = ['sys.view_phone_numbers', 'sys.manage_phone_numbers', 'sys.comms', 'sys.manage_users'];
export const PHONE_NUMBER_MANAGE_PERMISSIONS = ['sys.manage_phone_numbers', 'sys.comms', 'sys.manage_users'];
export const PHONE_NUMBER_DELETE_PERMISSIONS = ['sys.manage_phone_numbers'];
export const PHONE_LOOKUP_UI_PERMISSIONS = PHONE_NUMBER_MANAGE_PERMISSIONS;
export const SMS_VIEW_PERMISSIONS = ['sys.view_sms', 'sys.manage_sms', 'sys.comms', 'sys.owner', 'sys.manage_notifications'];
export const SMS_MANAGE_PERMISSIONS = ['sys.manage_sms', 'sys.comms', 'sys.manage_notifications'];
export const SMS_DELETE_PERMISSIONS = ['sys.manage_sms', 'sys.manage_notifications'];
export const PHONE_CONFIG_VIEW_PERMISSIONS = ['sys.manage_phone_config', 'sys.manage_groups', 'sys.comms'];
export const PHONE_CONFIG_MANAGE_PERMISSIONS = PHONE_CONFIG_VIEW_PERMISSIONS;
export const PHONE_CONFIG_DELETE_PERMISSIONS = ['sys.manage_phone_config', 'sys.manage_groups'];
export const PHONE_HUB_ADMIN_PERMISSIONS = [...new Set([...PHONE_NUMBER_VIEW_PERMISSIONS, ...SMS_VIEW_PERMISSIONS, ...PHONE_CONFIG_VIEW_PERMISSIONS])];
export const PHONE_GROUP_DIRECTORY_PERMISSIONS = ['sys.view_groups', 'sys.manage_groups', 'sys.manage_group', 'sys.groups'];

export interface PhoneRelation { id: number; name?: string; display_name?: string; email?: string }
export interface PhoneNumberRow {
    id:number; created:number; modified:number; phone_number:string; country_code:string|null; region:string|null; state:string|null;
    carrier:string|null; line_type:string|null; is_mobile:boolean; is_voip:boolean; is_valid:boolean;
    registered_owner:string|null; owner_type:string|null; address_line1:string|null; address_city:string|null;
    address_state:string|null; address_zip:string|null; address_country:string|null; lookup_provider:string|null;
    lookup_expires_at:number|null; lookup_count:number; last_lookup_at:number|null;
}
export interface SmsRow {
    id:number; created:number; modified?:number; direction:string; from_number:string; to_number:string; body:string;
    status:string; provider:string|null; error_message:string|null; sent_at:number|null; delivered_at:number|null;
    user:PhoneRelation|number|null; group:PhoneRelation|number|null;
}
export interface PhoneConfigRow {
    id:number; created:number; modified:number; group:PhoneRelation|number|null; name:string; is_active:boolean;
    provider:'twilio'|'aws'|'mojo'; twilio_from_number:string|null; aws_region:string|null; aws_sender_id:string|null;
    mojo_remote_url:string|null; lookup_enabled:boolean; lookup_cache_days:number; test_mode:boolean;
}

const COMMON = new Set(['start','size','search']);
function listParams(params:Params, graph:string, filters:readonly string[], sorts:readonly string[], defaultSort:string, dateRange=false):Params {
    const out:Params={graph,start:params.start??0,size:params.size??25,sort:defaultSort};
    for(const key of COMMON)if(params[key]!=null&&params[key]!=='')out[key]=params[key];
    for(const key of filters)if(params[key]!=null&&params[key]!=='')out[key]=params[key];
    const requested=typeof params.sort==='string'?params.sort:'';
    if(sorts.includes(requested.replace(/^-/,'')))out.sort=requested;
    if(dateRange&&(params.dr_start||params.dr_end)){out.dr_field='created';if(params.dr_start)out.dr_start=params.dr_start;if(params.dr_end)out.dr_end=params.dr_end;}
    return out;
}
const relation=(value:unknown):PhoneRelation|number|null=>{
    if(typeof value==='number')return value;
    if(!value||typeof value!=='object')return null;
    const row=value as Record<string,unknown>;const id=Number(row.id);if(!Number.isFinite(id))return null;
    return {id,...(typeof row.name==='string'?{name:row.name}:{}),...(typeof row.display_name==='string'?{display_name:row.display_name}:{}),...(typeof row.email==='string'?{email:row.email}:{})};
};
const text=(value:unknown)=>typeof value==='string'?value:null;
const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function sanitizePhoneNumberRow(input:PhoneNumberRow):PhoneNumberRow {
    const row=input as unknown as Record<string,unknown>;
    return {id:Number(row.id),created:Number(row.created??0),modified:Number(row.modified??0),phone_number:String(row.phone_number??''),country_code:text(row.country_code),region:text(row.region),state:text(row.state),carrier:text(row.carrier),line_type:text(row.line_type),is_mobile:Boolean(row.is_mobile),is_voip:Boolean(row.is_voip),is_valid:Boolean(row.is_valid),registered_owner:text(row.registered_owner),owner_type:text(row.owner_type),address_line1:text(row.address_line1),address_city:text(row.address_city),address_state:text(row.address_state),address_zip:text(row.address_zip),address_country:text(row.address_country),lookup_provider:text(row.lookup_provider),lookup_expires_at:num(row.lookup_expires_at),lookup_count:Number(row.lookup_count??0),last_lookup_at:num(row.last_lookup_at)};
}
export function sanitizeSmsRow(input:SmsRow):SmsRow {
    const row=input as unknown as Record<string,unknown>;
    return {id:Number(row.id),created:Number(row.created??0),modified:num(row.modified)??undefined,direction:String(row.direction??''),from_number:String(row.from_number??''),to_number:String(row.to_number??''),body:String(row.body??''),status:String(row.status??''),provider:text(row.provider),error_message:text(row.error_message),sent_at:num(row.sent_at),delivered_at:num(row.delivered_at),user:relation(row.user),group:relation(row.group)};
}
export function sanitizePhoneConfigRow(input:PhoneConfigRow):PhoneConfigRow {
    const row=input as unknown as Record<string,unknown>;const provider=['twilio','aws','mojo'].includes(String(row.provider))?String(row.provider) as PhoneConfigRow['provider']:'twilio';
    return {id:Number(row.id),created:Number(row.created??0),modified:Number(row.modified??0),group:relation(row.group),name:String(row.name??''),is_active:Boolean(row.is_active),provider,twilio_from_number:text(row.twilio_from_number),aws_region:text(row.aws_region),aws_sender_id:text(row.aws_sender_id),mojo_remote_url:text(row.mojo_remote_url),lookup_enabled:Boolean(row.lookup_enabled),lookup_cache_days:Number(row.lookup_cache_days??90),test_mode:Boolean(row.test_mode)};
}

export const PhoneNumberModel=defineModel<PhoneNumberRow>({name:'phone-number',endpoint:'/api/phonehub/number',permissions:{view:PHONE_NUMBER_VIEW_PERMISSIONS,manage:PHONE_NUMBER_MANAGE_PERMISSIONS,delete:PHONE_NUMBER_DELETE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',[],['phone_number','carrier','line_type','lookup_count','last_lookup_at','created','modified'],'phone_number'),sanitizeRow:sanitizePhoneNumberRow});
export const SmsModel=defineModel<SmsRow>({name:'sms-audit',endpoint:'/api/phonehub/sms',permissions:{view:SMS_VIEW_PERMISSIONS,manage:SMS_MANAGE_PERMISSIONS,delete:SMS_DELETE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',['direction','status','provider','group','user'],['created','direction','status','provider','sent_at','delivered_at'],'-created',true),sanitizeRow:sanitizeSmsRow});
export const PhoneConfigModel=defineModel<PhoneConfigRow>({name:'phone-config',endpoint:'/api/phonehub/config',permissions:{view:PHONE_CONFIG_VIEW_PERMISSIONS,manage:PHONE_CONFIG_MANAGE_PERMISSIONS,delete:PHONE_CONFIG_DELETE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',['provider','is_active','group','test_mode'],['name','provider','is_active','created','modified'],'name'),sanitizeRow:sanitizePhoneConfigRow});
