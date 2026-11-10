import { Navbar } from '@/components/layout/Navbar'
import { WhatsAppBanner } from '@/components/mensagens/WhatsAppBanner'
import { ClinicProvider } from '@/components/layout/ClinicProvider'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClinicProvider>
      <div className="min-h-screen bg-porcelana">
        <Navbar />
        <main className="pt-14 pb-16 md:pb-0 md:pl-[220px]">
          <WhatsAppBanner />
          {children}
        </main>
      </div>
    </ClinicProvider>
  )
}
