import { cookies } from 'next/headers'
import { Navbar } from '@/components/layout/Navbar'
import { WhatsAppBanner } from '@/components/mensagens/WhatsAppBanner'
import { ClinicProvider } from '@/components/layout/ClinicProvider'
import { MenuLateralProvider } from '@/components/layout/MenuLateral'
import { COOKIE_MENU, COOKIE_PAINEL_AGENDA, estaRecolhido } from '@/components/layout/menuLateralCookie'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const preferencias = await cookies()

  return (
    <ClinicProvider>
      <MenuLateralProvider
        recolhidoInicial={estaRecolhido(preferencias.get(COOKIE_MENU)?.value)}
        painelAgendaRecolhidoInicial={estaRecolhido(preferencias.get(COOKIE_PAINEL_AGENDA)?.value)}
        className="group/app min-h-screen bg-porcelana print:bg-white"
      >
        <div className="print:hidden">
          <Navbar />
        </div>
        <main className="pt-14 pb-16 md:pb-0 md:pl-[220px] md:group-data-[menu=recolhido]/app:pl-16 motion-safe:transition-[padding] motion-safe:duration-200 print:p-0">
          <div className="print:hidden">
            <WhatsAppBanner />
          </div>
          {children}
        </main>
      </MenuLateralProvider>
    </ClinicProvider>
  )
}
