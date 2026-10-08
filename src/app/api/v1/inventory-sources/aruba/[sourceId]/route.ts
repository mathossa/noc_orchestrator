import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { updateClassicCentralConnection, type ClassicCentralSiteScope } from '@/lib/aruba-classic-integration-store'

type Context={params:Promise<{sourceId:string}>}
export async function PATCH(request:Request,context:Context){
  try{
    await requireAdminRequest(request)
    const {sourceId}=await context.params
    const body=await request.json() as Record<string,unknown>
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Request body must be an object.')
    const tokens=['clientId','clientSecret','accessToken','refreshToken'] as const
    const replacesCredentials=tokens.some((field)=>body[field]!==undefined)
    if(replacesCredentials&&tokens.some((field)=>typeof body[field]!=='string')){
      throw new Error('All four Classic Central credential fields must be supplied together.')
    }
    const sites=body.sites===undefined?undefined:(
      Array.isArray(body.sites)?body.sites.map((value):ClassicCentralSiteScope=>{
        if(!value||typeof value!=='object'||typeof value.siteName!=='string'||typeof value.enabled!=='boolean'){
          throw new Error('Each site requires siteName and enabled.')
        }
        return {siteId:typeof value.siteId==='string'?value.siteId:null,siteName:value.siteName,enabled:value.enabled,site:typeof value.site==='string'?value.site:null}
      }):(()=>{throw new Error('sites must be an array.')})()
    )
    const data=await updateClassicCentralConnection({
      sourceId,
      name:typeof body.name==='string'?body.name:undefined,
      baseUrl:typeof body.baseUrl==='string'?body.baseUrl:undefined,
      customer:typeof body.customer==='string'?body.customer:undefined,
      businessUnit:typeof body.businessUnit==='string'?body.businessUnit:undefined,
      sites,
      scopeMode:body.scopeMode==='SELECTED_SITES'||body.scopeMode==='ALL_DEVICES'?body.scopeMode:undefined,
      enabled:typeof body.enabled==='boolean'?body.enabled:undefined,
      credentials:replacesCredentials?{
        clientId:body.clientId as string,clientSecret:body.clientSecret as string,
        accessToken:body.accessToken as string,refreshToken:body.refreshToken as string,
      }:undefined,
    })
    return NextResponse.json({data})
  }catch(error){
    if(error instanceof AdminAccessError)return NextResponse.json({error:{code:'ACCESS_DENIED',message:error.message}},{status:error.status})
    if(error instanceof SyntaxError)return NextResponse.json({error:{code:'INVALID_JSON',message:'Request body must be valid JSON.'}},{status:400})
    const message=error instanceof Error?error.message:'Unable to update Aruba connection.'
    return NextResponse.json({error:{code:'ARUBA_UPDATE_FAILED',message}},{status:message.includes('not found')?404:400})
  }
}
