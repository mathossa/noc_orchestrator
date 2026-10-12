import { NextResponse } from 'next/server'
import { AdminAccessError,requireAdminRequest } from '@/lib/api-admin'
import {
  discoverClassicCentralSites,
} from '@/lib/aruba-classic-integration-store'
type Context={params:Promise<{sourceId:string}>}
export async function POST(request:Request,context:Context){
  try{
    await requireAdminRequest(request)
    const {sourceId}=await context.params
    return NextResponse.json({data:await discoverClassicCentralSites(sourceId)})
  }catch(error){
    if(error instanceof AdminAccessError)return NextResponse.json({error:{code:'ACCESS_DENIED',message:error.message}},{status:error.status})
    const message=error instanceof Error?error.message:'Unable to discover Aruba Central sites.'
    return NextResponse.json({error:{code:'ARUBA_SITE_DISCOVERY_FAILED',message}},{status:message.includes('not found')?404:400})
  }
}
