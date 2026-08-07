import { defineModel, registerNonFilterParams, type Params } from '../../../client';

registerNonFilterParams('push_surface');

export const PUSH_DEVICE_VIEW_PERMISSIONS = ['sys.view_devices', 'sys.manage_devices', 'sys.comms', 'sys.owner', 'sys.manage_users'];
export const PUSH_DEVICE_MANAGE_PERMISSIONS = ['sys.manage_devices', 'sys.comms', 'sys.owner'];
export const PUSH_DELIVERY_VIEW_PERMISSIONS = ['sys.view_notifications', 'sys.manage_notifications', 'sys.comms', 'sys.owner', 'sys.manage_users'];
export const PUSH_DELIVERY_MANAGE_PERMISSIONS = ['sys.manage_notifications', 'sys.comms'];
export const PUSH_TEMPLATE_VIEW_PERMISSIONS = ['sys.manage_notifications', 'sys.manage_groups', 'sys.comms', 'sys.owner', 'sys.manage_users'];
export const PUSH_TEMPLATE_MANAGE_PERMISSIONS = ['sys.manage_notifications', 'sys.manage_groups', 'sys.comms'];
export const PUSH_CONFIG_VIEW_PERMISSIONS = ['sys.manage_push_config', 'sys.manage_groups', 'sys.comms'];
export const PUSH_CONFIG_MANAGE_PERMISSIONS = PUSH_CONFIG_VIEW_PERMISSIONS;
export const PUSH_CONFIG_TEST_PERMISSIONS = ['sys.manage_push_config', 'sys.comms'];
export const PUSH_METRICS_PERMISSIONS = ['sys.view_metrics', 'sys.metrics'];
export const PUSH_GROUP_DIRECTORY_PERMISSIONS = ['sys.view_groups', 'sys.manage_groups', 'sys.manage_group', 'sys.groups'];
export const PUSH_ADMIN_PERMISSIONS = [...new Set([
    ...PUSH_DEVICE_VIEW_PERMISSIONS, ...PUSH_DELIVERY_VIEW_PERMISSIONS,
    ...PUSH_TEMPLATE_VIEW_PERMISSIONS, ...PUSH_CONFIG_VIEW_PERMISSIONS,
    ...PUSH_METRICS_PERMISSIONS,
])];

export interface PushRelation { id:number; name?:string; display_name?:string }
export interface PushDeviceRow { id:number; device_id:string; platform:'ios'|'android'|'web'|string; device_name:string; app_version:string; os_version:string; push_enabled:boolean; push_preferences:Record<string,boolean>; last_seen:number; user:PushRelation|null }
export interface PushDeliveryRow { id:number; created:number; title:string|null; body:string|null; category:string; action_url:string|null; status:'pending'|'sent'|'delivered'|'failed'|string; sent_at:number|null; delivered_at:number|null; error_message:string|null; user:PushRelation|null; device:PushRelation|null }
export interface PushTemplateRow { id:number; name:string; title_template:string|null; body_template:string|null; action_url:string|null; data_template:Record<string,unknown>; category:string; priority:'low'|'normal'|'high'; variables:Record<string,unknown>; is_active:boolean; group:PushRelation|null }
export interface PushConfigRow { id:number; created:number; modified:number; name:string; test_mode:boolean; default_sound:string; is_active:boolean; fcm_project_id:string|null; group:PushRelation|null }

const asText=(value:unknown,max=2000):string|null=>typeof value==='string'?value.slice(0,max):null;
const asEpoch=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
function relation(value:unknown):PushRelation|null { if(!value||typeof value!=='object')return null;const row=value as Record<string,unknown>;const id=Number(row.id);if(!Number.isFinite(id))return null;return {id,...(typeof row.name==='string'?{name:row.name.slice(0,120)}:{}),...(typeof row.display_name==='string'?{display_name:row.display_name.slice(0,120)}:{})}; }
function safeObject(value:unknown,limit=50):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return {};const out:Record<string,unknown>={};for(const [key,item] of Object.entries(value).slice(0,limit)){if(typeof item==='string')out[key.slice(0,100)]=item.slice(0,2000);else if(typeof item==='number'||typeof item==='boolean'||item==null)out[key.slice(0,100)]=item;}return out;}
export function sanitizePushDeviceRow(input:PushDeviceRow):PushDeviceRow {const row=input as unknown as Record<string,unknown>;const preferences=safeObject(row.push_preferences);return {id:Number(row.id),device_id:String(row.device_id??'').slice(0,255),platform:String(row.platform??''),device_name:String(row.device_name??'').slice(0,100),app_version:String(row.app_version??'').slice(0,50),os_version:String(row.os_version??'').slice(0,50),push_enabled:Boolean(row.push_enabled),push_preferences:Object.fromEntries(Object.entries(preferences).filter((entry):entry is [string,boolean]=>typeof entry[1]==='boolean')),last_seen:asEpoch(row.last_seen)??0,user:relation(row.user)};}
export function sanitizePushDeliveryRow(input:PushDeliveryRow):PushDeliveryRow {const row=input as unknown as Record<string,unknown>;return {id:Number(row.id),created:asEpoch(row.created)??0,title:asText(row.title,200),body:asText(row.body,10_000),category:String(row.category??'').slice(0,50),action_url:asText(row.action_url,2000),status:String(row.status??''),sent_at:asEpoch(row.sent_at),delivered_at:asEpoch(row.delivered_at),error_message:asText(row.error_message,2000),user:relation(row.user),device:relation(row.device)};}
export function sanitizePushTemplateRow(input:PushTemplateRow):PushTemplateRow {const row=input as unknown as Record<string,unknown>;const priority=['low','normal','high'].includes(String(row.priority))?String(row.priority) as PushTemplateRow['priority']:'normal';return {id:Number(row.id),name:String(row.name??'').slice(0,100),title_template:asText(row.title_template,200),body_template:asText(row.body_template,10_000),action_url:asText(row.action_url,2000),data_template:safeObject(row.data_template),category:String(row.category??'general').slice(0,50),priority,variables:safeObject(row.variables),is_active:Boolean(row.is_active),group:relation(row.group)};}
export function sanitizePushConfigRow(input:PushConfigRow):PushConfigRow {const row=input as unknown as Record<string,unknown>;return {id:Number(row.id),created:asEpoch(row.created)??0,modified:asEpoch(row.modified)??0,name:String(row.name??'').slice(0,100),test_mode:Boolean(row.test_mode),default_sound:String(row.default_sound??'default').slice(0,50),is_active:Boolean(row.is_active),fcm_project_id:asText(row.fcm_project_id,200),group:relation(row.group)};}

const BASE_KEYS=new Set(['start','size','search']);
function listParams(params:Params,graph:'basic'|'default',filters:readonly string[],sorts:readonly string[],defaultSort:string,dateRange=false):Params{const out:Params={graph,start:params.start??0,size:params.size??25,sort:defaultSort};for(const key of BASE_KEYS)if(params[key]!=null&&params[key]!=='')out[key]=params[key];for(const key of filters)if(params[key]!=null&&params[key]!=='')out[key]=params[key];const sort=typeof params.sort==='string'?params.sort:'';if(sorts.includes(sort.replace(/^-/,'')))out.sort=sort;if(dateRange&&(params.dr_start||params.dr_end)){out.dr_field='created';if(params.dr_start)out.dr_start=params.dr_start;if(params.dr_end)out.dr_end=params.dr_end;}return out;}

export const PushDeviceModel=defineModel<PushDeviceRow>({name:'push-device',endpoint:'/api/account/devices/push',permissions:{view:PUSH_DEVICE_VIEW_PERMISSIONS,manage:PUSH_DEVICE_MANAGE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',['platform','push_enabled','is_active','user'],['last_seen','platform','device_name','push_enabled'],'-last_seen'),sanitizeRow:sanitizePushDeviceRow});
export const PushDeliveryModel=defineModel<PushDeliveryRow>({name:'push-delivery',endpoint:'/api/account/devices/push/deliveries',permissions:{view:PUSH_DELIVERY_VIEW_PERMISSIONS,manage:PUSH_DELIVERY_MANAGE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',['status','category','user','device'],['created','status','category','sent_at','delivered_at'],'-created',true),sanitizeRow:sanitizePushDeliveryRow});
export const PushTemplateModel=defineModel<PushTemplateRow>({name:'push-template',endpoint:'/api/account/devices/push/templates',permissions:{view:PUSH_TEMPLATE_VIEW_PERMISSIONS,manage:PUSH_TEMPLATE_MANAGE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',['category','priority','is_active','group'],['name','category','priority','is_active'],'name'),sanitizeRow:sanitizePushTemplateRow});
export const PushConfigModel=defineModel<PushConfigRow>({name:'push-config',endpoint:'/api/account/devices/push/config',permissions:{view:PUSH_CONFIG_VIEW_PERMISSIONS,manage:PUSH_CONFIG_MANAGE_PERMISSIONS},normalizeListParams:p=>listParams(p,'default',['test_mode','is_active','group'],['name','test_mode','is_active','created','modified'],'name'),sanitizeRow:sanitizePushConfigRow});
