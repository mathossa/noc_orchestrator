import { PageHeader } from '@/components/ui/page-header'
import { ArubaClassicConnectionCreateForm } from '@/components/settings/aruba-classic-connection-create-form'
export default function NewArubaConnectionPage(){
  return <div className="space-y-6">
    <PageHeader eyebrow="Settings · Integrations" title="Add HPE Aruba Central"
      description="Classic Central is supported first; tokens are encrypted and inventory uses the shared Importer v2 reconciliation pipeline."
      breadcrumbs={[{label:'Settings',href:'/settings'},{label:'Integrations',href:'/settings/integrations'},{label:'Add Aruba connection'}]} />
    <ArubaClassicConnectionCreateForm />
  </div>
}
