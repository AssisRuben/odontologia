import type { Metadata } from 'next'
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google'
import './globals.css'

const texto = Instrument_Sans({ subsets: ['latin'], variable: '--font-texto' })
const titulo = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-titulo' })

export const metadata: Metadata = {
  title: 'Dental - Gestão de Clínica Odontológica',
  description: 'Sistema completo de gestão para clínicas odontológicas',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`h-full ${texto.variable} ${titulo.variable}`}>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  )
}
