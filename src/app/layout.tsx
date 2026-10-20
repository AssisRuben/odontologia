import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Dental - Gestão de Clínica Odontológica',
  description: 'Sistema completo de gestão para clínicas odontológicas',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className={`${inter.className} h-full antialiased`}>{children}</body>
    </html>
  )
}
