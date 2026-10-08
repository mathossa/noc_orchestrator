import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { createClassicCentralConnection } from '@/lib/aruba-classic-integration-store'

export async function POST(request: Request) {
  try {
    await requireAdminRequest(request)
    const body = await request.json() as Record<string,unknown>
    const required=['name','baseUrl','clientId','clientSecret','accessToken','refreshToken'] as const
    if (!body || required.some((field)=>typeof body[field]!=='string')) {
      throw new Error('name, Classic Central gateway, client ID/secret, access token and refresh token are required.')
    }
    if (body.variant !== 'CLASSIC') {
      throw new Error('Use the Classic Central API variant. New Central requires separate credentials.')
    }
    const data=await createClassicCentralConnection({
      name:body.name as string,baseUrl:body.baseUrl as string,
      customer:typeof body.customer==='string'?body.customer:null,
      businessUnit:typeof body.businessUnit==='string'?body.businessUnit:null,
      credentials:{
        clientId:body.clientId as string,clientSecret:body.clientSecret as string,
        accessToken:body.accessToken as string,refreshToken:body.refreshToken as string,
      },
    })
    return NextResponse.json({data},{status:201})
  } catch(error) {
    if (error instanceof AdminAccessError) return NextResponse.json({error:{code:'ACCESS_DENIED',message:error.message}},{status:error.status})
    if (error instanceof SyntaxError) return NextResponse.json({error:{code:'INVALID_JSON',message:'Request body must be valid JSON.'}},{status:400})
    return NextResponse.json({error:{code:'ARUBA_CREATE_FAILED',message:error instanceof Error?error.message:'Unable to create Aruba connection.'}},{status:400})
  }
}
