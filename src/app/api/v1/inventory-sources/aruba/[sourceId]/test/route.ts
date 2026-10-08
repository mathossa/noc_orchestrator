import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { ArubaCentralApiError } from '@/lib/aruba-central-api-client'
import { testClassicCentralConnection } from '@/lib/aruba-classic-integration-store'
type Context={params:Promise<{sourceId:string}>}
export async function POST(request:Request,context:Context){
  try{
    await requireAdminRequest(request)
    return NextResponse.json({data:await testClassicCentralConnection((await context.params).sourceId)})
  }catch(error){
    if(error instanceof AdminAccessError)return NextResponse.json({error:{code:'ACCESS_DENIED',message:error.message}},{status:error.status})
    const message=error instanceof Error?error.message:'Unable to test Aruba connection.'
    return NextResponse.json({error:{code:'ARUBA_TEST_FAILED',message,
      ...(error instanceof ArubaCentralApiError?{providerStatus:error.status,retryable:error.retryable}:{})}},{status:message.includes('not found')?404:400})
  }
}
