import { Navbar } from '@/components/layout/Navbar'
import { ClinicProvider } from '@/components/layout/ClinicProvider'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClinicProvider>
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="pt-14 pb-16 md:pb-0">{children}</main>
      </div>
    </ClinicProvider>
  )
}
