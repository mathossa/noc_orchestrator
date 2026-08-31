import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin } from 'better-auth/plugins'
import { prisma } from './prisma'

const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const microsoftClientId = process.env.MICROSOFT_CLIENT_ID
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET
const microsoftTenantId = process.env.MICROSOFT_TENANT_ID

const microsoftProvider =
  microsoftClientId && microsoftClientSecret && microsoftTenantId
    ? {
        microsoft: {
          clientId: microsoftClientId,
          clientSecret: microsoftClientSecret,
          tenantId: microsoftTenantId,
        },
      }
    : undefined

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    autoSignIn: false,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
  },
  ...(microsoftProvider ? { socialProviders: microsoftProvider } : {}),
  user: {
    modelName: 'User',
  },
  session: {
    modelName: 'AuthSession',
  },
  account: {
    modelName: 'AuthAccount',
    identityStrategy: 'provider-id',
  },
  verification: {
    modelName: 'AuthVerification',
  },
  plugins: [admin()],
  advanced: {
    database: {
      generateId: 'uuid',
      joins: true,
    },
  },
})
