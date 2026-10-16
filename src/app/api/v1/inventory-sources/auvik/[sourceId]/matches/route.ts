import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { cleanAuvikHierarchyLabel, normalizeAuvikHierarchyNames } from '@/lib/auvik-tenant-matching'

type Context = { params: Promise<{ sourceId: string }> }

const key = (value: string) => cleanAuvikHierarchyLabel(value).toLocaleLowerCase('en-US')

/**
 * Small, admin-only canonical lookup for the active Auvik tenant editor.
 * Never creates records, changes a mapping, or guesses between duplicate
 * canonical entities. The customer scope is required for an existing Site.
 */
export async function GET(request: Request, context: Context) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const source = await prisma.inventorySource.findUnique({
      where: { id: sourceId },
      select: { provider: true, adapterType: true },
    })
    if (source?.provider !== 'AUVIK' || source.adapterType !== 'auvik-api-v2') {
      return NextResponse.json({ error: { message: 'Auvik connection not found.' } }, { status: 404 })
    }
    const params = new URL(request.url).searchParams
    const field = params.get('field')
    const query = cleanAuvikHierarchyLabel(params.get('q') ?? '').slice(0, 120)
    const customerName = cleanAuvikHierarchyLabel(params.get('customer') ?? '').slice(0, 120)
    const unitName = cleanAuvikHierarchyLabel(params.get('businessUnit') ?? '').slice(0, 120)
    if (!['customer', 'businessUnit', 'site'].includes(field ?? '')) {
      return NextResponse.json({ error: { message: 'Invalid mapping field.' } }, { status: 400 })
    }
    if (query.length < 2) return NextResponse.json({ data: { options: [], status: 'NOT_FOUND' } })

    const customerRecords = customerName
      ? await prisma.customer.findMany({
          where: { isActive: true, name: { equals: customerName, mode: 'insensitive' } },
          select: { id: true, name: true },
          take: 3,
        })
      : []
    const customer = customerRecords.length === 1 ? customerRecords[0] : null
    if (field === 'customer') {
      const records = await prisma.customer.findMany({
        where: { isActive: true, name: { contains: query, mode: 'insensitive' } },
        orderBy: { name: 'asc' }, take: 12,
        select: { id: true, name: true },
      })
      const exact = records.filter((record) => key(record.name) === key(query))
      return NextResponse.json({ data: {
        options: records.map((record) => ({
          id: record.id, name: record.name, customerName: record.name, businessUnit: null,
          relation: 'SAME_CUSTOMER',
        })),
        status: exact.length === 1 ? 'EXISTING' : exact.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND',
      } })
    }

    if (field === 'businessUnit') {
      if (!customer) return NextResponse.json({ data: { options: [], status: 'NOT_FOUND' } })
      const records = await prisma.customerOrganizationUnit.findMany({
        where: { isActive: true, customerId: customer.id, name: { contains: query, mode: 'insensitive' } },
        take: 12, orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      const exact = records.filter((record) => key(record.name) === key(query))
      return NextResponse.json({ data: {
        options: records.map((record) => ({
          id: record.id, name: record.name, customerName: customer.name, businessUnit: record.name,
          relation: 'SAME_CUSTOMER',
        })),
        status: exact.length === 1 ? 'EXISTING' : exact.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND',
      } })
    }

    const siteFilter = { isActive: true, name: { contains: query, mode: 'insensitive' as const } }
    const fields = {
      id: true, name: true, customer: { select: { id: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
    } as const
    const [sameCustomer, otherCustomers] = await Promise.all([
      customer ? prisma.site.findMany({
        where: { ...siteFilter, customerId: customer.id },
        take: 16, orderBy: { name: 'asc' }, select: fields,
      }) : Promise.resolve([]),
      prisma.site.findMany({
        where: { ...siteFilter, ...(customer ? { customerId: { not: customer.id } } : {}) },
        take: 8, orderBy: { name: 'asc' }, select: fields,
      }),
    ])
    const sites = [...sameCustomer, ...otherCustomers]
    const options = sites
      .map((site) => ({
        id: site.id, name: site.name,
        customerName: site.customer.name,
        businessUnit: site.organizationUnit?.name ?? null,
        relation: customer && site.customer.id === customer.id ? 'SAME_CUSTOMER' as const : 'OTHER_CUSTOMER' as const,
      }))
      .sort((a, b) => (a.relation === 'SAME_CUSTOMER' ? 0 : 1) - (b.relation === 'SAME_CUSTOMER' ? 0 : 1))
      .slice(0, 12)
    const matchesSite = (option: (typeof options)[number]) => {
      const legacyNormalized = normalizeAuvikHierarchyNames(
        [option.customerName, ...(option.businessUnit ? [option.businessUnit] : []), option.name],
      )?.site
      return key(option.name) === key(query) || key(legacyNormalized ?? '') === key(query)
    }
    const matching = options.filter((option) =>
      option.relation === 'SAME_CUSTOMER' && matchesSite(option) &&
      (!unitName || key(option.businessUnit ?? '') === key(unitName)),
    )
    const otherMatches = options.filter((option) =>
      (option.relation === 'OTHER_CUSTOMER' ||
        (unitName && key(option.businessUnit ?? '') !== key(unitName))) &&
      matchesSite(option))
    return NextResponse.json({ data: {
      options,
      status: matching.length === 1 ? 'EXISTING'
        : matching.length > 1 ? 'AMBIGUOUS'
          : otherMatches.length ? 'POSSIBLE_DUPLICATE'
            : 'NOT_FOUND',
    } })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status })
    }
    return NextResponse.json({ error: { message: 'Could not search canonical mappings.' } }, { status: 400 })
  }
}
