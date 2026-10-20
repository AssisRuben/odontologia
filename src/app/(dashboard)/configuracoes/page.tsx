import Link from 'next/link'
import { Building2, Users, CreditCard, MessageSquare, Shield, FileText, ChevronRight } from 'lucide-react'

const configCards = [
  {
    id: 'clinica',
    title: 'Configurações da clínica',
    description: 'Nome, CNPJ, telefone, endereço e logotipo da clínica.',
    icon: Building2,
    color: '#3B82F6',
  },
  {
    id: 'profissionais',
    title: 'Gestão de profissionais',
    description: 'Cadastre e gerencie os profissionais da clínica.',
    icon: Users,
    color: '#10B981',
  },
  {
    id: 'taxas',
    title: 'Taxas de maquininhas',
    description: 'Configure as taxas de cada bandeira de cartão.',
    icon: CreditCard,
    color: '#F59E0B',
  },
  {
    id: 'mensagens',
    title: 'Configurações de mensagens',
    description: 'Templates e configurações de WhatsApp e SMS.',
    icon: MessageSquare,
    color: '#8B5CF6',
  },
  {
    id: 'convenios',
    title: 'Gestão de convênios',
    description: 'Cadastre e gerencie os convênios atendidos.',
    icon: Shield,
    color: '#06B6D4',
  },
  {
    id: 'anamnese',
    title: 'Modelos de anamnese',
    description: 'Crie e edite modelos de anamnese para seus pacientes.',
    icon: FileText,
    color: '#EF4444',
  },
]

export default function ConfiguracoesPage() {
  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-[#111827] mb-6">Configurações</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {configCards.map((card) => (
          <Link
            key={card.id}
            href={`/configuracoes/${card.id}`}
            className="bg-white rounded-xl border border-[#E5E7EB] p-6 text-left hover:border-[#3B82F6] hover:shadow-md transition-all group flex items-start gap-4"
          >
            <div
              className="w-12 h-12 rounded-xl shrink-0 flex items-center justify-center"
              style={{ backgroundColor: card.color + '15' }}
            >
              <card.icon className="w-6 h-6" style={{ color: card.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-[#111827] mb-1 group-hover:text-[#3B82F6] transition-colors">
                {card.title}
              </h2>
              <p className="text-sm text-[#6B7280]">{card.description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-[#D1D5DB] group-hover:text-[#3B82F6] shrink-0 mt-1 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
