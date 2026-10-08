'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { InventorySourceSchedulePanel, type InventorySourceSyncRun } from '@/components/settings/inventory-source-schedule-panel'

type Site={siteId?:string|null;siteName:string;enabled:boolean;site:string|null}
type Connection={
  id:string;name:string;enabled:boolean;sourceAdapterId:string
  configuration:{version:1;variant:'CLASSIC';baseUrl:string;scopeMode:'SELECTED_SITES';customer:string|null;businessUnit:string|null;sites:readonly Site[]}
  credentialsConfigured:boolean
  connectionTest:{status:'UNTESTED'|'SUCCESS'|'FAILED';testedAt:string|null;httpStatus:number|null}
}
async function responseData(response:Response){
  const data=await response.json()
  if(!response.ok)throw new Error(data?.error?.message??'Aruba Central request failed.')
  return data.data
}
export function ArubaClassicConnectionManager({initialConnection,initialSyncRuns}:{
  initialConnection:Connection;initialSyncRuns:InventorySourceSyncRun[]
}){
  const router=useRouter()
  const [connection,setConnection]=useState(initialConnection)
  const [name,setName]=useState(connection.name)
  const [baseUrl,setBaseUrl]=useState(connection.configuration.baseUrl)
  const [customer,setCustomer]=useState(connection.configuration.customer??'')
  const [businessUnit,setBusinessUnit]=useState(connection.configuration.businessUnit??'')
  const [sites,setSites]=useState<Site[]>([...connection.configuration.sites])
  const [clientId,setClientId]=useState('')
  const [clientSecret,setClientSecret]=useState('')
  const [accessToken,setAccessToken]=useState('')
  const [refreshToken,setRefreshToken]=useState('')
  const [busy,setBusy]=useState<string|null>(null)
  const [message,setMessage]=useState<string|null>(null)
  const [discoveryMessage,setDiscoveryMessage]=useState<string|null>(null)
  const [reviewBatchId,setReviewBatchId]=useState<string|null>(null)
  const [syncRuns,setSyncRuns]=useState(initialSyncRuns)
  const endpoint=`/api/v1/inventory-sources/aruba/${connection.id}`
  const perform=async(kind:string,request:()=>Promise<void>)=>{
    setBusy(kind);setMessage(null)
    try{await request()}catch(error){setMessage(error instanceof Error?error.message:'Aruba request failed.')}
    finally{setBusy(null)}
  }
  const save=()=>perform('save',async()=>{
    const replacement=[clientId,clientSecret,accessToken,refreshToken].some((value)=>value.trim())
      ? {clientId,clientSecret,accessToken,refreshToken} : {}
    const data=await responseData(await fetch(endpoint,{
      method:'PATCH',headers:{'content-type':'application/json'},
      body:JSON.stringify({name,baseUrl,customer,businessUnit,sites,...replacement}),
    })) as Connection
    setConnection(data);setSites([...data.configuration.sites])
    setClientId('');setClientSecret('');setAccessToken('');setRefreshToken('')
    setMessage('Aruba Central settings saved.');router.refresh()
  })
  const test=()=>perform('test',async()=>{
    await responseData(await fetch(`${endpoint}/test`,{method:'POST'}))
    setConnection(current=>({...current,connectionTest:{status:'SUCCESS',testedAt:new Date().toISOString(),httpStatus:null}}))
    setMessage('Classic Central token refresh succeeded.');router.refresh()
  })
  const enable=(enabled:boolean)=>perform('enable',async()=>{
    const data=await responseData(await fetch(endpoint,{
      method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled}),
    })) as Connection
    setConnection(data)
    setMessage(enabled?'Aruba sync enabled.':'Aruba sync disabled.')
    router.refresh()
  })
  const discover=()=>perform('discover',async()=>{
    const result=await responseData(await fetch(`${endpoint}/sites`,{method:'POST'})) as {
      sites:Array<{id:string|null;name:string;origin:'SITE_CATALOG'|'DEVICE_EVIDENCE'}>
      catalogCount:number;observedDeviceCount:number|null
      unassignedDeviceCount:number|null;observedGroupCount:number|null
    }
    const found=result.sites
    setSites(current=>{
      const previous=new Map(current.map(site=>[site.siteName.toLowerCase(),site]))
      return [
        ...current.filter(site=>!found.some(candidate=>candidate.name.toLowerCase()===site.siteName.toLowerCase())),
        ...found.map(site=>({
          ...(previous.get(site.name.toLowerCase()) ?? {
            siteId:site.id,siteName:site.name,enabled:false,site:site.name,
          }),
          siteId:previous.get(site.name.toLowerCase())?.siteId??site.id,
        })),
      ]
    })
    const evidenceMessage=result.catalogCount===0
      ? `Central site API returned 0 sites. Monitoring saw ${result.observedDeviceCount??0} devices, of which ${result.unassignedDeviceCount??0} have no site field; ${result.observedGroupCount??0} Aruba groups are not physical sites.`
      : `Central site API returned ${result.catalogCount} sites.`
    setDiscoveryMessage(evidenceMessage)
    setMessage(`Found ${found.length} sites. New sites are disabled; review the selection and save. ${found.length===0?'Confirm devices have physical sites assigned in the customer tenant in Aruba Central.':''}`)
    router.refresh()
  })
  const sync=()=>perform('sync',async()=>{
    const result=await responseData(await fetch(`${endpoint}/sync`,{method:'POST'}))
    const publication=result.autoPublication
    setReviewBatchId(publication.reconciliationRequired?result.batch.id:null)
    if(result.syncRun){
      const run=result.syncRun
      setSyncRuns(current=>[{
        ...run,startedAt:new Date(run.startedAt).toISOString(),
        finishedAt:run.finishedAt?new Date(run.finishedAt).toISOString():null,
      },...current].slice(0,20))
    }
    setMessage(`Aruba Classic staged ${result.source.deviceCount} devices from ${result.source.selectedSiteCount} selected sites; ${result.source.excludedFromScopeCount} outside the site selection were excluded; ${publication.publishedLogicalDeviceCount} auto-published, ${publication.remainingIncludedRows} need review.`)
  })
  const changeSite=(name:string,partial:Partial<Site>)=>setSites(current=>current.map(site=>site.siteName===name?{...site,...partial}:site))
  const enabledSites=connection.configuration.sites.filter(site=>site.enabled).length
  const hasScope=enabledSites>0
  const canSync=connection.enabled&&connection.connectionTest.status==='SUCCESS'&&hasScope
  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="text-xs text-[var(--muted)]">Connection</div>
        <StatusBadge tone={connection.enabled?'success':'neutral'}>{connection.enabled?'Enabled':'Disabled'}</StatusBadge>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="text-xs text-[var(--muted)]">Connection test</div>
        <StatusBadge tone={connection.connectionTest.status==='SUCCESS'?'success':connection.connectionTest.status==='FAILED'?'danger':'neutral'}>{connection.connectionTest.status}</StatusBadge>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="text-xs text-[var(--muted)]">Enabled sites</div>
        <div className="text-2xl font-semibold">{enabledSites}</div>
      </div>
    </div>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Classic Central settings</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Credentials are encrypted; replacement requires all four values. Changing gateway or tokens disables sync until the next successful test.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy!==null} onClick={()=>void test()}>Test connection</Button>
          <Button disabled={busy!==null||(!connection.enabled&&(connection.connectionTest.status!=='SUCCESS'||!hasScope||!connection.configuration.customer))} onClick={()=>void enable(!connection.enabled)}>{connection.enabled?'Disable':'Enable'}</Button>
          <Button variant="primary" disabled={busy!==null||!canSync} onClick={()=>void sync()}>{busy==='sync'?'Syncing…':'Sync now'}</Button>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {([
          ['Connection name',name,setName],
          ['Classic API gateway',baseUrl,setBaseUrl],
          ['Customer',customer,setCustomer],
          ['Business unit',businessUnit,setBusinessUnit],
        ] as const).map(([label,value,set])=><label key={label} className="space-y-1 text-sm">
          <span className="font-semibold">{label}</span>
          <input value={value} onChange={event=>set(event.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"/>
        </label>)}
        {([
          ['Replace client ID',clientId,setClientId],
          ['Replace client secret',clientSecret,setClientSecret],
          ['Replace access token',accessToken,setAccessToken],
          ['Replace refresh token',refreshToken,setRefreshToken],
        ] as const).map(([label,value,set])=><label key={label} className="space-y-1 text-sm">
          <span className="font-semibold">{label}</span>
          <input type="password" autoComplete="off" placeholder="Leave blank to retain existing value" value={value} onChange={event=>set(event.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"/>
        </label>)}
      </div>
    </section>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-5">
        <div><h2 className="font-semibold">Classic Central sites</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">One Classic Central connection is one customer tenant. Discover its sites, select which sites to sync and map them to NOC sites. Aruba groups are not sites.</p>
        </div>
        <Button disabled={busy!==null} onClick={()=>void discover()}>Discover Central sites</Button>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-xs text-[var(--muted)]">
          Only checked and saved sites under this customer are imported. Devices
          without a selected site are excluded, including during scheduled sync.
        </p>
        {discoveryMessage?<p role="status" className="text-sm text-[var(--muted-strong)]">{discoveryMessage}</p>:null}
        {sites.length===0?<p className="text-sm text-[var(--muted)]">No Central sites found yet. Assign physical sites under this customer in Aruba Central, then discover and enable them before syncing.</p>:null}
        {sites.map(site=><div key={site.siteName} className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[auto_1fr_1fr] md:items-center">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={site.enabled} onChange={event=>changeSite(site.siteName,{enabled:event.target.checked})}/>
            Include
          </label>
          <div className="text-sm font-semibold">{site.siteName}</div>
          <label className="space-y-1 text-xs"><span>NOC site</span>
            <input value={site.site??''} onChange={event=>changeSite(site.siteName,{site:event.target.value})}
              className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-sm"/>
          </label>
        </div>)}
      </div>
      <div className="flex justify-end border-t border-[var(--border)] p-5">
        <Button variant="primary" disabled={busy!==null} onClick={()=>void save()}>{busy==='save'?'Saving…':'Save settings & site selection'}</Button>
      </div>
    </section>
    {message?<p role="status" className="text-sm text-[var(--muted-strong)]">{message}</p>:null}
    {reviewBatchId?<Link href={`/devices/import/${reviewBatchId}`} className="text-sm text-[var(--accent-light)] hover:underline">Inspect devices needing review</Link>:null}
    <InventorySourceSchedulePanel provider="aruba" sourceId={connection.id} enabled={connection.enabled}
      connectionTestPassed={connection.connectionTest.status==='SUCCESS'}
      hasEnabledScope={hasScope} syncRuns={syncRuns}/>
  </div>
}
