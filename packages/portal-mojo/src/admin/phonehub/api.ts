import type { QueryClient } from '@tanstack/react-query';
import { mojoCall, mojoList } from '../../client/runtime';
import { PhoneConfigModel, sanitizePhoneConfigRow, sanitizePhoneNumberRow, type PhoneConfigRow, type PhoneNumberRow, type PhoneRelation } from './models';

export const PHONE_GROUP_CHOICE_LIMIT=100;
export const PHONE_SECRET_FIELDS=['twilio_account_sid','twilio_auth_token','aws_access_key_id','aws_secret_access_key','mojo_api_key'] as const;
export type PhoneSecretField=(typeof PHONE_SECRET_FIELDS)[number];
export type SecretEdit={mode:'untouched'}|{mode:'replace';value:string}|{mode:'clear';confirmed:true};

export async function normalizePhoneNumber(phoneNumber:string,countryCode?:string):Promise<string>{
    const body=await mojoCall('/api/phonehub/number/normalize',{method:'POST',body:{phone_number:phoneNumber,...(countryCode?{country_code:countryCode}:{})}});
    const value=(body.data as {phone_number?:unknown}|undefined)?.phone_number;
    if(typeof value!=='string'||!/^\+[1-9]\d{7,14}$/.test(value))throw new Error('The server did not return a valid E.164 phone number.');
    return value;
}
export async function lookupPhoneNumber(phoneNumber:string,previous?:PhoneNumberRow,confirmFresh?:()=>boolean|Promise<boolean>):Promise<PhoneNumberRow>{
    const normalized=await normalizePhoneNumber(phoneNumber);
    const fresh=Boolean(previous?.lookup_expires_at&&previous.lookup_expires_at>Date.now()/1000);
    if(fresh&&!(await confirmFresh?.()))throw new Error('Fresh lookup cancelled.');
    const body=await mojoCall('/api/phonehub/number/lookup',{method:'POST',body:{phone_number:normalized,...(fresh?{force_refresh:true}:{})}});
    const row=sanitizePhoneNumberRow(body.data as PhoneNumberRow);
    const advanced=previous?row.lookup_count>previous.lookup_count||Boolean(row.last_lookup_at&&row.last_lookup_at!==(previous.last_lookup_at??null)):row.lookup_count>=1&&row.last_lookup_at!=null;
    if(!advanced)throw new Error('The lookup provider returned no refresh evidence. The cached record was left unchanged.');
    return row;
}
export function buildPhoneConfigPayload(scalars:Record<string,unknown>,credentials:Partial<Record<PhoneSecretField,SecretEdit>>):Record<string,unknown>{
    const body={...scalars};
    for(const field of PHONE_SECRET_FIELDS){const edit=credentials[field];if(!edit||edit.mode==='untouched')continue;if(edit.mode==='clear')body[field]=null;else{const value=edit.value.trim();if(!value)throw new Error(`${field} replacements cannot be empty.`);body[field]=value;}}
    return body;
}
export async function savePhoneConfigImperative(qc:QueryClient,id:number|null,scalars:Record<string,unknown>,credentials:Partial<Record<PhoneSecretField,SecretEdit>>):Promise<PhoneConfigRow>{
    const payload=buildPhoneConfigPayload(scalars,credentials);
    const path=id==null?PhoneConfigModel.endpoint:`${PhoneConfigModel.endpoint}/${id}`;
    const response=await mojoCall(path,{method:'POST',body:payload});
    for(const field of PHONE_SECRET_FIELDS)delete payload[field];
    const row=sanitizePhoneConfigRow(response.data as PhoneConfigRow);
    qc.setQueryData(PhoneConfigModel.keys.one(row.id),row);await qc.invalidateQueries({queryKey:PhoneConfigModel.keys.root});return row;
}
export async function testPhoneConfigImperative(id:number):Promise<{status:boolean;message:string}>{
    const response=await mojoCall(`${PhoneConfigModel.endpoint}/${id}`,{method:'POST',body:{test_connection:1}});
    const data=(response.data??response) as Record<string,unknown>;
    return {status:data.status!==false,message:typeof data.message==='string'?data.message:'Connection test completed.'};
}
export async function fetchPhoneGroupChoices():Promise<PhoneRelation[]>{
    const result=await mojoList<Record<string,unknown>>('/api/group',{graph:'basic',sort:'name',start:0,size:PHONE_GROUP_CHOICE_LIMIT});
    return result.rows.flatMap(row=>{const id=Number(row.id);return Number.isFinite(id)&&typeof row.name==='string'?[{id,name:row.name}]:[];});
}
