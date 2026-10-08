'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
export function ArubaClassicConnectionCreateForm() {
  const router=useRouter()
  const [name,setName]=useState('Aruba Central Classic')
  const [baseUrl,setBaseUrl]=useState('https://eu-apigw.central.arubanetworks.com')
  const [customer,setCustomer]=useState('')
  const [businessUnit,setBusinessUnit]=useState('')
  const [clientId,setClientId]=useState('')
  const [clientSecret,setClientSecret]=useState('')
  const [accessToken,setAccessToken]=useState('')
  const [refreshToken,setRefreshToken]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState<string|null>(null)
  const submit=async()=>{
    setBusy(true);setMessage(null)
    try {
      const response=await fetch('/api/v1/inventory-sources/aruba',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({name,variant:'CLASSIC',baseUrl,customer,businessUnit,clientId,clientSecret,accessToken,refreshToken}),
      })
      const data=await response.json()
      if(!response.ok)throw new Error(data?.error?.message??'Unable to save Aruba connection.')
      router.push(`/settings/integrations/aruba/${data.data.id}`)
      router.refresh()
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to create connection.')}
    finally{setBusy(false)}
  }
  const fields=[
    {label:'Name',value:name,set:setName},
    {label:'Classic Central API Gateway URL',value:baseUrl,set:setBaseUrl},
    {label:'Customer',value:customer,set:setCustomer},
    {label:'Business unit (optional)',value:businessUnit,set:setBusinessUnit},
    {label:'API client ID',value:clientId,set:setClientId},
    {label:'API client secret',value:clientSecret,set:setClientSecret,secret:true},
    {label:'Access token',value:accessToken,set:setAccessToken,secret:true},
    {label:'Refresh token',value:refreshToken,set:setRefreshToken,secret:true},
  ]
  return <div className="space-y-5">
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="font-semibold">Classic Central connection</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">Generate an API application and tokens in Classic Central API Gateway. This form stores all tokens encrypted server-side; credentials are never returned to the browser. New Central uses different credentials.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {fields.map(field=><label key={field.label} className="space-y-1 text-sm">
          <span className="font-semibold">{field.label}</span>
          <input type={field.secret?'password':'text'} autoComplete="off" value={field.value} onChange={e=>field.set(e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3" />
        </label>)}
      </div>
    </section>
    {message?<p role="alert" className="text-sm text-[var(--danger)]">{message}</p>:null}
    <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={()=>void submit()}>{busy?'Saving…':'Save Classic Central connection'}</Button></div>
  </div>
}
