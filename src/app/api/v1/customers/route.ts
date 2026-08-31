import { NextResponse } from 'next/server'
import { customerApiError } from '@/lib/customer-api'
import { createCustomer, listCustomerContractTypes, listCustomers } from '@/lib/customer-store'

export async function GET() {
  try {
    const [customers, contractTypes] = await Promise.all([listCustomers(), listCustomerContractTypes()])
    return NextResponse.json({ data: customers, contractTypes })
  } catch (error) {
    return customerApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ data: await createCustomer(body) }, { status: 201 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return customerApiError(error)
  }
}
