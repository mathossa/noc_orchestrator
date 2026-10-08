import { NextResponse } from 'next/server'
import { AdminAccessError,requireAdminRequest } from '@/lib/api-admin'
import { ArubaCentralApiError } from '@/lib/aruba-central-api-client'
import { runClassicCentralInventorySync } from '@/lib/aruba-classic-inventory-sync'
type Context={params:Promise<{sourceId:string}>}
export async function POST(request:Request,context:Context){
  try{
    await requireAdminRequest(request)
    const result=await runClassicCentralInventorySync((await context.params).sourceId)
    return NextResponse.json({data:{
      batch:result.batch,profile:result.profile,evaluation:result.evaluation,
      source:result.source,automation:result.automation,
      autoPublication:result.autoPublication,syncRun:result.syncRun,
    }})
  }catch(error){
    if(error instanceof AdminAccessError)return NextResponse.json({error:{code:'ACCESS_DENIED',message:error.message}},{status:error.status})
    const message=error instanceof Error?error.message:'Unable to synchronize Aruba inventory.'
    return NextResponse.json({error:{code:'ARUBA_SYNC_FAILED',message,
      ...(error instanceof ArubaCentralApiError?{providerStatus:error.status,retryable:error.retryable}:{})}},{status:message.includes('not found')?404:400})
  }
}
