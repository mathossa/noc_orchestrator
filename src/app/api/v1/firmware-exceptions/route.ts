import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { FirmwareExceptionError } from '@/lib/firmware-exceptions'
import {
  addExceptionReason,
  createFirmwareException,
  exceptionReferenceData,
  listFirmwareExceptions,
  previewFirmwareException,
  supersedeFirmwareException,
} from '@/lib/firmware-exception-store'

function errorResponse(error: unknown) {
  if (error instanceof FirmwareExceptionError)
    return NextResponse.json(
      { error: { message: error.message } },
      { status: error.status },
    )
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: { message: 'Enter valid JSON.' } },
      { status: 400 },
    )
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2034', 'P2002'].includes(String(error.code))
  )
    return NextResponse.json(
      {
        error: {
          message:
            'The data changed or this reason already exists. Refresh and preview again.',
        },
      },
      { status: 409 },
    )
  console.error('Firmware exception error', error)
  return NextResponse.json(
    { error: { message: 'Could not process firmware exceptions.' } },
    { status: 500 },
  )
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    return NextResponse.json({
      data:
        url.searchParams.get('references') === 'true'
          ? await exceptionReferenceData()
          : await listFirmwareExceptions(
              url.searchParams.get('deviceId') ?? undefined,
            ),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    const actorUserId = session?.user.id ?? null
    const body = await request.json()

    if (body.action === 'preview')
      return NextResponse.json({
        data: await previewFirmwareException(body.input),
      })

    if (body.action === 'create')
      return NextResponse.json(
        {
          data: await createFirmwareException(
            body.input,
            actorUserId as string,
            body.token,
          ),
        },
        { status: 201 },
      )

    if (body.action === 'supersede' && typeof body.id === 'string')
      return NextResponse.json({
        data: await supersedeFirmwareException(body.id, actorUserId as string),
      })

    if (body.action === 'reason') {
      if (!session)
        return NextResponse.json(
          { error: { message: 'Sign in as an administrator to add reason codes.' } },
          { status: 401 },
        )
      if (session.user.role !== 'admin')
        return NextResponse.json(
          { error: { message: 'An administrator can add reason codes.' } },
          { status: 403 },
        )
      return NextResponse.json(
        { data: await addExceptionReason(body.input, session.user.id) },
        { status: 201 },
      )
    }

    throw new FirmwareExceptionError('Choose a valid action.')
  } catch (error) {
    return errorResponse(error)
  }
}
