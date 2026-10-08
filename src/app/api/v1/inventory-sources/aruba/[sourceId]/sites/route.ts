import { NextResponse } from 'next/server'
import { AdminAccessError,requireAdminRequest } from '@/lib/api-admin'
import {
  getClassicCentralConnectionCredentials,
  testClassicCentralConnection,
} from '@/lib/aruba-classic-integration-store'
import { listClassicCentralSites } from '@/lib/aruba-classic-central-api-client'
type Context={params:Promise<{sourceId:string}>}
export async function POST(request:Request,context:Context){
  try{
    await requireAdminRequest(request)
    const {sourceId}=await context.params
    // Renew the Classic token before the on-demand discovery request, avoiding
    // silently expired access and refreshing its 15-day rotating secret.
    await testClassicCentralConnection(sourceId)
    const {connection,credentials}=await getClassicCentralConnectionCredentials(sourceId)
    return NextResponse.json({data:await listClassicCentralSites({
      configuration:connection.configuration,accessToken:credentials.accessToken,
    })})
  }catch(error){
    if(error instanceof AdminAccessError)return NextResponse.json({error:{code:'ACCESS_DENIED',message:error.message}},{status:error.status})
    const message=error instanceof Error?error.message:'Unable to discover Aruba Central sites.'
    return NextResponse.json({error:{code:'ARUBA_SITE_DISCOVERY_FAILED',message}},{status:message.includes('not found')?404:400})
  }
}
