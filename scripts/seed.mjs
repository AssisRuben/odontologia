import { createClient } from '@supabase/supabase-js'

// Clínica que recebe os dados: CLINIC_ID do ambiente ou, se não houver, a primeira clínica do banco
let CLINIC_ID = process.env.CLINIC_ID

// Rodar com: node --env-file=.env.local scripts/seed.mjs
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ex.: node --env-file=.env.local scripts/seed.mjs)')
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Proper UUIDs for all entities
const IP1 = 'aa000001-0000-4000-8000-000000000001'
const IP2 = 'aa000001-0000-4000-8000-000000000002'
const IP3 = 'aa000001-0000-4000-8000-000000000003'
const IP4 = 'aa000001-0000-4000-8000-000000000004'
const IP5 = 'aa000001-0000-4000-8000-000000000005'

const P1 = 'bb000001-0000-4000-8000-000000000001'
const P2 = 'bb000001-0000-4000-8000-000000000002'
const P3 = 'bb000001-0000-4000-8000-000000000003'
const P4 = 'bb000001-0000-4000-8000-000000000004'

const PA = (n) => `cc000001-0000-4000-8000-${String(n).padStart(12, '0')}`
const AP = (n) => `dd000001-0000-4000-8000-${String(n).padStart(12, '0')}`
const PY = (n) => `ee000001-0000-4000-8000-${String(n).padStart(12, '0')}`
const EX = (n) => `ff000001-0000-4000-8000-${String(n).padStart(12, '0')}`
const PR = (n) => `a1000001-0000-4000-8000-${String(n).padStart(12, '0')}`
const IV = (n) => `a2000001-0000-4000-8000-${String(n).padStart(12, '0')}`

async function seed() {
  if (!CLINIC_ID) {
    const { data: clinic } = await supabase.from('clinics').select('id').order('created_at').limit(1).maybeSingle()
    if (!clinic) { console.error('Nenhuma clínica no banco. Crie uma conta em /register antes de rodar o seed.'); return }
    CLINIC_ID = clinic.id
  }

  console.log('🚀 Iniciando seed de dados para clinic:', CLINIC_ID)

  // ── Convênios ──────────────────────────────────────────────────────────────
  const { data: plans, error: plansErr } = await supabase
    .from('insurance_plans')
    .upsert([
      { id: IP1, clinic_id: CLINIC_ID, name: 'Particular' },
      { id: IP2, clinic_id: CLINIC_ID, name: 'SulAmérica' },
      { id: IP3, clinic_id: CLINIC_ID, name: 'Unimed' },
      { id: IP4, clinic_id: CLINIC_ID, name: 'Bradesco Saúde' },
      { id: IP5, clinic_id: CLINIC_ID, name: 'Amil' },
    ], { onConflict: 'id' })
    .select('id, name')
  if (plansErr) { console.error('Convênios:', plansErr.message); return }
  console.log('✅ Convênios:', plans.length)

  // ── Profissionais ──────────────────────────────────────────────────────────
  const { data: profs, error: profsErr } = await supabase
    .from('professionals')
    .upsert([
      { id: P1, clinic_id: CLINIC_ID, name: 'Dr. Carlos Mendes',   cro: 'SP-45231', specialty: 'Clínico Geral', color: '#3B82F6' },
      { id: P2, clinic_id: CLINIC_ID, name: 'Dra. Ana Ferreira',   cro: 'SP-67891', specialty: 'Ortodontia',    color: '#10B981' },
      { id: P3, clinic_id: CLINIC_ID, name: 'Dr. Roberto Lima',    cro: 'SP-23456', specialty: 'Endodontia',    color: '#F59E0B' },
      { id: P4, clinic_id: CLINIC_ID, name: 'Dra. Patrícia Costa', cro: 'SP-89012', specialty: 'Periodontia',   color: '#8B5CF6' },
    ], { onConflict: 'id' })
    .select('id, name')
  if (profsErr) { console.error('Profissionais:', profsErr.message); return }
  console.log('✅ Profissionais:', profs.length)

  // ── Pacientes ──────────────────────────────────────────────────────────────
  const patients = [
    { id: PA(1),  clinic_id: CLINIC_ID, name: 'Maria Silva Santos',       cpf: '123.456.789-01', phone: '11987654321', whatsapp: '11987654321', email: 'maria.silva@email.com',      birthdate: '1985-03-15', gender: 'F', insurance_plan_id: IP1, notes: 'Alérgica a penicilina' },
    { id: PA(2),  clinic_id: CLINIC_ID, name: 'João Pedro Oliveira',      cpf: '234.567.890-12', phone: '11976543210', whatsapp: '11976543210', email: 'joao.pedro@email.com',       birthdate: '1978-07-22', gender: 'M', insurance_plan_id: IP2, notes: null },
    { id: PA(3),  clinic_id: CLINIC_ID, name: 'Ana Carolina Ferreira',    cpf: '345.678.901-23', phone: '11965432109', whatsapp: '11965432109', email: 'ana.carolina@email.com',      birthdate: '1992-11-08', gender: 'F', insurance_plan_id: IP3, notes: 'Bruxismo' },
    { id: PA(4),  clinic_id: CLINIC_ID, name: 'Pedro Henrique Costa',     cpf: '456.789.012-34', phone: '11954321098', whatsapp: '11954321098', email: 'pedro.costa@email.com',       birthdate: '1965-05-30', gender: 'M', insurance_plan_id: IP1, notes: null },
    { id: PA(5),  clinic_id: CLINIC_ID, name: 'Fernanda Lima Rodrigues',  cpf: '567.890.123-45', phone: '11943210987', whatsapp: '11943210987', email: 'fernanda.lima@email.com',     birthdate: '1990-01-25', gender: 'F', insurance_plan_id: IP4, notes: null },
    { id: PA(6),  clinic_id: CLINIC_ID, name: 'Lucas Martins Alves',      cpf: '678.901.234-56', phone: '11932109876', whatsapp: '11932109876', email: 'lucas.martins@email.com',     birthdate: '1995-09-14', gender: 'M', insurance_plan_id: IP2, notes: null },
    { id: PA(7),  clinic_id: CLINIC_ID, name: 'Juliana Costa Pereira',    cpf: '789.012.345-67', phone: '11921098765', whatsapp: '11921098765', email: 'juliana.costa@email.com',     birthdate: '1988-12-03', gender: 'F', insurance_plan_id: IP5, notes: 'Ansiedade durante procedimentos' },
    { id: PA(8),  clinic_id: CLINIC_ID, name: 'Roberto Souza Neves',      cpf: '890.123.456-78', phone: '11910987654', whatsapp: '11910987654', email: 'roberto.souza@email.com',     birthdate: '1972-04-18', gender: 'M', insurance_plan_id: IP1, notes: null },
    { id: PA(9),  clinic_id: CLINIC_ID, name: 'Camila Rodrigues Silva',   cpf: '901.234.567-89', phone: '11909876543', whatsapp: '11909876543', email: 'camila.rodrigues@email.com',  birthdate: '1997-08-27', gender: 'F', insurance_plan_id: IP3, notes: null },
    { id: PA(10), clinic_id: CLINIC_ID, name: 'Rafael Alves Cardoso',     cpf: '012.345.678-90', phone: '11898765432', whatsapp: '11898765432', email: 'rafael.alves@email.com',      birthdate: '1983-02-10', gender: 'M', insurance_plan_id: IP2, notes: null },
    { id: PA(11), clinic_id: CLINIC_ID, name: 'Beatriz Nunes Mendes',     cpf: '111.222.333-44', phone: '11887654321', whatsapp: '11887654321', email: 'beatriz.nunes@email.com',     birthdate: '1991-06-19', gender: 'F', insurance_plan_id: IP1, notes: null },
    { id: PA(12), clinic_id: CLINIC_ID, name: 'Gustavo Pereira Ramos',    cpf: '222.333.444-55', phone: '11876543210', whatsapp: '11876543210', email: 'gustavo.pereira@email.com',   birthdate: '1975-10-05', gender: 'M', insurance_plan_id: IP4, notes: null },
    { id: PA(13), clinic_id: CLINIC_ID, name: 'Larissa Cardoso Teixeira', cpf: '333.444.555-66', phone: '11865432109', whatsapp: '11865432109', email: 'larissa.cardoso@email.com',   birthdate: '1993-05-25', gender: 'F', insurance_plan_id: IP2, notes: null },
    { id: PA(14), clinic_id: CLINIC_ID, name: 'Thiago Ramos Barbosa',     cpf: '444.555.666-77', phone: '11854321098', whatsapp: '11854321098', email: 'thiago.ramos@email.com',      birthdate: '1980-03-07', gender: 'M', insurance_plan_id: IP3, notes: null },
    { id: PA(15), clinic_id: CLINIC_ID, name: 'Vanessa Teixeira Moura',   cpf: '555.666.777-88', phone: '11843210987', whatsapp: '11843210987', email: 'vanessa.teixeira@email.com',  birthdate: '1987-07-16', gender: 'F', insurance_plan_id: IP5, notes: 'Gestante - 5 meses' },
    { id: PA(16), clinic_id: CLINIC_ID, name: 'Diego Barbosa Freitas',    cpf: '666.777.888-99', phone: '11832109876', whatsapp: '11832109876', email: 'diego.barbosa@email.com',     birthdate: '1999-11-30', gender: 'M', insurance_plan_id: IP1, notes: null },
    { id: PA(17), clinic_id: CLINIC_ID, name: 'Isabela Moura Cunha',      cpf: '777.888.999-00', phone: '11821098765', whatsapp: '11821098765', email: 'isabela.moura@email.com',     birthdate: '1994-09-12', gender: 'F', insurance_plan_id: IP2, notes: null },
    { id: PA(18), clinic_id: CLINIC_ID, name: 'Marcos Freitas Leal',      cpf: '888.999.000-11', phone: '11810987654', whatsapp: '11810987654', email: 'marcos.freitas@email.com',    birthdate: '1968-01-23', gender: 'M', insurance_plan_id: IP1, notes: 'Hipertenso - pressão controlada' },
    { id: PA(19), clinic_id: CLINIC_ID, name: 'Renata Cunha Azevedo',     cpf: '999.000.111-22', phone: '11809876543', whatsapp: '11809876543', email: 'renata.cunha@email.com',      birthdate: '1986-04-04', gender: 'F', insurance_plan_id: IP3, notes: null },
    { id: PA(20), clinic_id: CLINIC_ID, name: 'Felipe Azevedo Correia',   cpf: '000.111.222-33', phone: '11798765432', whatsapp: '11798765432', email: 'felipe.azevedo@email.com',    birthdate: '1996-08-21', gender: 'M', insurance_plan_id: IP4, notes: null },
    { id: PA(21), clinic_id: CLINIC_ID, name: 'Patricia Correia Dias',    cpf: '111.333.555-77', phone: '11787654321', whatsapp: '11787654321', email: 'patricia.dias@email.com',     birthdate: '1973-12-17', gender: 'F', insurance_plan_id: IP2, notes: null },
    { id: PA(22), clinic_id: CLINIC_ID, name: 'André Dias Nascimento',    cpf: '222.444.666-88', phone: '11776543210', whatsapp: '11776543210', email: 'andre.dias@email.com',        birthdate: '1989-02-28', gender: 'M', insurance_plan_id: IP5, notes: null },
    { id: PA(23), clinic_id: CLINIC_ID, name: 'Sophia Nascimento Vieira', cpf: '333.555.777-99', phone: '11765432109', whatsapp: '11765432109', email: 'sophia.vieira@email.com',     birthdate: '2001-05-10', gender: 'F', insurance_plan_id: IP1, notes: null },
    { id: PA(24), clinic_id: CLINIC_ID, name: 'Eduardo Vieira Pinto',     cpf: '444.666.888-00', phone: '11754321098', whatsapp: '11754321098', email: 'eduardo.vieira@email.com',    birthdate: '1982-10-11', gender: 'M', insurance_plan_id: IP3, notes: null },
    { id: PA(25), clinic_id: CLINIC_ID, name: 'Monique Pinto Farias',     cpf: '555.777.999-11', phone: '11743210987', whatsapp: '11743210987', email: 'monique.pinto@email.com',     birthdate: '1998-03-29', gender: 'F', insurance_plan_id: IP2, notes: null },
  ]

  const { error: patientsErr } = await supabase.from('patients').upsert(patients, { onConflict: 'id' })
  if (patientsErr) { console.error('Pacientes:', patientsErr.message); return }
  console.log('✅ Pacientes:', patients.length)

  // ── Agendamentos ───────────────────────────────────────────────────────────
  // Semana passada: 19-23 Mai 2026
  // Semana atual:   26-30 Mai 2026
  // Próxima semana: 02-06 Jun 2026
  const appointments = [
    // Semana passada (concluídos)
    { id: AP(1),  clinic_id: CLINIC_ID, patient_id: PA(1),  professional_id: P1, start_time: '2026-05-19T08:00:00', end_time: '2026-05-19T09:00:00', status: 'completed', procedure: 'Limpeza e profilaxia',    notes: null },
    { id: AP(2),  clinic_id: CLINIC_ID, patient_id: PA(2),  professional_id: P2, start_time: '2026-05-19T09:00:00', end_time: '2026-05-19T10:30:00', status: 'completed', procedure: 'Manutenção de aparelho',   notes: null },
    { id: AP(3),  clinic_id: CLINIC_ID, patient_id: PA(3),  professional_id: P3, start_time: '2026-05-19T10:00:00', end_time: '2026-05-19T12:00:00', status: 'completed', procedure: 'Tratamento de canal',      notes: 'Dente 16' },
    { id: AP(4),  clinic_id: CLINIC_ID, patient_id: PA(4),  professional_id: P4, start_time: '2026-05-19T14:00:00', end_time: '2026-05-19T15:00:00', status: 'completed', procedure: 'Raspagem periodontal',     notes: null },
    { id: AP(5),  clinic_id: CLINIC_ID, patient_id: PA(5),  professional_id: P1, start_time: '2026-05-20T08:00:00', end_time: '2026-05-20T09:00:00', status: 'completed', procedure: 'Restauração',              notes: 'Dente 21' },
    { id: AP(6),  clinic_id: CLINIC_ID, patient_id: PA(6),  professional_id: P2, start_time: '2026-05-20T09:30:00', end_time: '2026-05-20T11:00:00', status: 'completed', procedure: 'Instalação de aparelho',   notes: 'Aparelho metálico' },
    { id: AP(7),  clinic_id: CLINIC_ID, patient_id: PA(7),  professional_id: P1, start_time: '2026-05-20T14:00:00', end_time: '2026-05-20T15:00:00', status: 'no_show',   procedure: 'Consulta avaliação',      notes: 'Paciente não compareceu' },
    { id: AP(8),  clinic_id: CLINIC_ID, patient_id: PA(8),  professional_id: P3, start_time: '2026-05-21T08:00:00', end_time: '2026-05-21T10:00:00', status: 'completed', procedure: 'Retratamento de canal',    notes: null },
    { id: AP(9),  clinic_id: CLINIC_ID, patient_id: PA(9),  professional_id: P4, start_time: '2026-05-21T10:00:00', end_time: '2026-05-21T11:00:00', status: 'completed', procedure: 'Cirurgia periodontal',     notes: null },
    { id: AP(10), clinic_id: CLINIC_ID, patient_id: PA(10), professional_id: P1, start_time: '2026-05-21T14:00:00', end_time: '2026-05-21T15:00:00', status: 'completed', procedure: 'Clareamento dental',       notes: null },
    { id: AP(11), clinic_id: CLINIC_ID, patient_id: PA(11), professional_id: P2, start_time: '2026-05-22T09:00:00', end_time: '2026-05-22T10:00:00', status: 'completed', procedure: 'Consulta ortodôntica',     notes: null },
    { id: AP(12), clinic_id: CLINIC_ID, patient_id: PA(12), professional_id: P4, start_time: '2026-05-22T10:00:00', end_time: '2026-05-22T11:30:00', status: 'completed', procedure: 'Gengivoplastia',           notes: null },
    { id: AP(13), clinic_id: CLINIC_ID, patient_id: PA(13), professional_id: P1, start_time: '2026-05-22T14:00:00', end_time: '2026-05-22T15:00:00', status: 'completed', procedure: 'Extração simples',         notes: 'Dente 18' },
    { id: AP(14), clinic_id: CLINIC_ID, patient_id: PA(14), professional_id: P3, start_time: '2026-05-23T08:00:00', end_time: '2026-05-23T10:00:00', status: 'completed', procedure: 'Canal dente 46',           notes: null },
    { id: AP(15), clinic_id: CLINIC_ID, patient_id: PA(15), professional_id: P1, start_time: '2026-05-23T10:00:00', end_time: '2026-05-23T11:00:00', status: 'completed', procedure: 'Consulta gestante',        notes: 'Cuidados especiais' },

    // Semana atual (26-30 Mai 2026)
    { id: AP(16), clinic_id: CLINIC_ID, patient_id: PA(1),  professional_id: P1, start_time: '2026-05-26T08:00:00', end_time: '2026-05-26T09:00:00', status: 'confirmed', procedure: 'Retorno limpeza',           notes: null },
    { id: AP(17), clinic_id: CLINIC_ID, patient_id: PA(16), professional_id: P2, start_time: '2026-05-26T09:00:00', end_time: '2026-05-26T10:30:00', status: 'confirmed', procedure: 'Colocação de aparelho',     notes: null },
    { id: AP(18), clinic_id: CLINIC_ID, patient_id: PA(3),  professional_id: P3, start_time: '2026-05-26T10:00:00', end_time: '2026-05-26T12:00:00', status: 'scheduled', procedure: 'Canal 2ª sessão',           notes: 'Dente 16 - continuação' },
    { id: AP(19), clinic_id: CLINIC_ID, patient_id: PA(17), professional_id: P4, start_time: '2026-05-26T14:00:00', end_time: '2026-05-26T15:30:00', status: 'scheduled', procedure: 'Consulta periodontal',      notes: null },
    { id: AP(20), clinic_id: CLINIC_ID, patient_id: PA(4),  professional_id: P1, start_time: '2026-05-27T08:00:00', end_time: '2026-05-27T09:00:00', status: 'waiting',   procedure: 'Restauração composta',     notes: null },
    { id: AP(21), clinic_id: CLINIC_ID, patient_id: PA(18), professional_id: P1, start_time: '2026-05-27T09:30:00', end_time: '2026-05-27T10:30:00', status: 'scheduled', procedure: 'Avaliação',                 notes: 'Monitorar pressão' },
    { id: AP(22), clinic_id: CLINIC_ID, patient_id: PA(5),  professional_id: P2, start_time: '2026-05-27T10:00:00', end_time: '2026-05-27T11:00:00', status: 'confirmed', procedure: 'Ajuste aparelho',           notes: null },
    { id: AP(23), clinic_id: CLINIC_ID, patient_id: PA(19), professional_id: P4, start_time: '2026-05-27T14:00:00', end_time: '2026-05-27T15:00:00', status: 'scheduled', procedure: 'Raspagem',                  notes: null },
    { id: AP(24), clinic_id: CLINIC_ID, patient_id: PA(6),  professional_id: P3, start_time: '2026-05-28T08:00:00', end_time: '2026-05-28T10:00:00', status: 'scheduled', procedure: 'Canal dente 36',            notes: null },
    { id: AP(25), clinic_id: CLINIC_ID, patient_id: PA(20), professional_id: P1, start_time: '2026-05-28T10:00:00', end_time: '2026-05-28T11:00:00', status: 'confirmed', procedure: 'Limpeza',                   notes: null },
    { id: AP(26), clinic_id: CLINIC_ID, patient_id: PA(7),  professional_id: P2, start_time: '2026-05-28T14:00:00', end_time: '2026-05-28T15:30:00', status: 'scheduled', procedure: 'Manutenção ortodôntica',    notes: 'Troca elásticos' },
    { id: AP(27), clinic_id: CLINIC_ID, patient_id: PA(21), professional_id: P1, start_time: '2026-05-29T08:00:00', end_time: '2026-05-29T09:00:00', status: 'scheduled', procedure: 'Extração dente 28',         notes: null },
    { id: AP(28), clinic_id: CLINIC_ID, patient_id: PA(8),  professional_id: P3, start_time: '2026-05-29T09:00:00', end_time: '2026-05-29T11:00:00', status: 'confirmed', procedure: 'Canal 3ª sessão',           notes: null },
    { id: AP(29), clinic_id: CLINIC_ID, patient_id: PA(22), professional_id: P4, start_time: '2026-05-29T14:00:00', end_time: '2026-05-29T15:00:00', status: 'scheduled', procedure: 'Avaliação periodontal',     notes: null },
    { id: AP(30), clinic_id: CLINIC_ID, patient_id: PA(9),  professional_id: P1, start_time: '2026-05-30T08:00:00', end_time: '2026-05-30T09:00:00', status: 'scheduled', procedure: 'Clareamento 2ª sessão',     notes: null },
    { id: AP(31), clinic_id: CLINIC_ID, patient_id: PA(10), professional_id: P2, start_time: '2026-05-30T09:00:00', end_time: '2026-05-30T10:00:00', status: 'scheduled', procedure: 'Consulta ortodôntica',      notes: null },

    // Próxima semana (2-6 Jun 2026)
    { id: AP(32), clinic_id: CLINIC_ID, patient_id: PA(11), professional_id: P1, start_time: '2026-06-02T08:00:00', end_time: '2026-06-02T09:00:00', status: 'scheduled', procedure: 'Restauração',               notes: null },
    { id: AP(33), clinic_id: CLINIC_ID, patient_id: PA(23), professional_id: P2, start_time: '2026-06-02T09:00:00', end_time: '2026-06-02T10:30:00', status: 'scheduled', procedure: 'Instalação aparelho',       notes: null },
    { id: AP(34), clinic_id: CLINIC_ID, patient_id: PA(12), professional_id: P3, start_time: '2026-06-02T10:00:00', end_time: '2026-06-02T12:00:00', status: 'scheduled', procedure: 'Canal dente 26',            notes: null },
    { id: AP(35), clinic_id: CLINIC_ID, patient_id: PA(24), professional_id: P4, start_time: '2026-06-03T08:00:00', end_time: '2026-06-03T09:00:00', status: 'scheduled', procedure: 'Raspagem',                  notes: null },
    { id: AP(36), clinic_id: CLINIC_ID, patient_id: PA(13), professional_id: P1, start_time: '2026-06-03T09:00:00', end_time: '2026-06-03T10:00:00', status: 'scheduled', procedure: 'Limpeza',                   notes: null },
    { id: AP(37), clinic_id: CLINIC_ID, patient_id: PA(14), professional_id: P3, start_time: '2026-06-04T08:00:00', end_time: '2026-06-04T10:00:00', status: 'scheduled', procedure: 'Retratamento canal',        notes: null },
    { id: AP(38), clinic_id: CLINIC_ID, patient_id: PA(25), professional_id: P2, start_time: '2026-06-04T10:00:00', end_time: '2026-06-04T11:30:00', status: 'scheduled', procedure: 'Avaliação ortodôntica',     notes: 'Primeira consulta' },
    { id: AP(39), clinic_id: CLINIC_ID, patient_id: PA(15), professional_id: P1, start_time: '2026-06-05T08:00:00', end_time: '2026-06-05T09:00:00', status: 'scheduled', procedure: 'Retorno pré-natal',         notes: null },
    { id: AP(40), clinic_id: CLINIC_ID, patient_id: PA(16), professional_id: P4, start_time: '2026-06-05T09:00:00', end_time: '2026-06-05T10:00:00', status: 'scheduled', procedure: 'Consulta periodontal',      notes: null },
    { id: AP(41), clinic_id: CLINIC_ID, patient_id: PA(2),  professional_id: P2, start_time: '2026-06-06T09:00:00', end_time: '2026-06-06T10:30:00', status: 'scheduled', procedure: 'Manutenção aparelho',       notes: null },
    { id: AP(42), clinic_id: CLINIC_ID, patient_id: PA(17), professional_id: P1, start_time: '2026-06-06T10:00:00', end_time: '2026-06-06T11:00:00', status: 'scheduled', procedure: 'Restauração',               notes: null },
    { id: AP(43), clinic_id: CLINIC_ID, patient_id: PA(18), professional_id: P3, start_time: '2026-06-06T14:00:00', end_time: '2026-06-06T16:00:00', status: 'scheduled', procedure: 'Canal dente 47',            notes: null },
  ]

  const { error: aptsErr } = await supabase.from('appointments').upsert(appointments, { onConflict: 'id' })
  if (aptsErr) { console.error('Agendamentos:', aptsErr.message); return }
  console.log('✅ Agendamentos:', appointments.length)

  // ── Pagamentos ─────────────────────────────────────────────────────────────
  const payments = [
    // Pagamentos realizados (semana passada)
    { id: PY(1),  clinic_id: CLINIC_ID, patient_id: PA(1),  appointment_id: AP(1),  amount: 180.00, payment_method: 'credit_card', status: 'paid',    due_date: '2026-05-19', paid_at: '2026-05-19', description: 'Limpeza e profilaxia' },
    { id: PY(2),  clinic_id: CLINIC_ID, patient_id: PA(2),  appointment_id: AP(2),  amount: 250.00, payment_method: 'health_plan', status: 'paid',    due_date: '2026-05-19', paid_at: '2026-05-19', description: 'Manutenção de aparelho' },
    { id: PY(3),  clinic_id: CLINIC_ID, patient_id: PA(3),  appointment_id: AP(3),  amount: 900.00, payment_method: 'bank_slip',   status: 'paid',    due_date: '2026-05-19', paid_at: '2026-05-20', description: 'Tratamento de canal - 1ª sessão' },
    { id: PY(4),  clinic_id: CLINIC_ID, patient_id: PA(4),  appointment_id: AP(4),  amount: 450.00, payment_method: 'health_plan', status: 'paid',    due_date: '2026-05-19', paid_at: '2026-05-19', description: 'Raspagem periodontal' },
    { id: PY(5),  clinic_id: CLINIC_ID, patient_id: PA(5),  appointment_id: AP(5),  amount: 280.00, payment_method: 'pix',         status: 'paid',    due_date: '2026-05-20', paid_at: '2026-05-20', description: 'Restauração' },
    { id: PY(6),  clinic_id: CLINIC_ID, patient_id: PA(6),  appointment_id: AP(6),  amount: 3500.00,payment_method: 'bank_slip',   status: 'paid',    due_date: '2026-05-20', paid_at: '2026-05-22', description: 'Instalação de aparelho ortodôntico' },
    { id: PY(7),  clinic_id: CLINIC_ID, patient_id: PA(8),  appointment_id: AP(8),  amount: 900.00, payment_method: 'credit_card', status: 'paid',    due_date: '2026-05-21', paid_at: '2026-05-21', description: 'Retratamento de canal' },
    { id: PY(8),  clinic_id: CLINIC_ID, patient_id: PA(9),  appointment_id: AP(9),  amount: 1200.00,payment_method: 'health_plan', status: 'paid',    due_date: '2026-05-21', paid_at: '2026-05-21', description: 'Cirurgia periodontal' },
    { id: PY(9),  clinic_id: CLINIC_ID, patient_id: PA(10), appointment_id: AP(10), amount: 650.00, payment_method: 'credit_card', status: 'paid',    due_date: '2026-05-21', paid_at: '2026-05-21', description: 'Clareamento dental' },
    { id: PY(10), clinic_id: CLINIC_ID, patient_id: PA(11), appointment_id: AP(11), amount: 200.00, payment_method: 'pix',         status: 'paid',    due_date: '2026-05-22', paid_at: '2026-05-22', description: 'Consulta ortodôntica' },
    { id: PY(11), clinic_id: CLINIC_ID, patient_id: PA(12), appointment_id: AP(12), amount: 800.00, payment_method: 'health_plan', status: 'paid',    due_date: '2026-05-22', paid_at: '2026-05-23', description: 'Gengivoplastia' },
    { id: PY(12), clinic_id: CLINIC_ID, patient_id: PA(13), appointment_id: AP(13), amount: 320.00, payment_method: 'cash',        status: 'paid',    due_date: '2026-05-22', paid_at: '2026-05-22', description: 'Extração simples' },
    { id: PY(13), clinic_id: CLINIC_ID, patient_id: PA(14), appointment_id: AP(14), amount: 900.00, payment_method: 'bank_slip',   status: 'paid',    due_date: '2026-05-23', paid_at: '2026-05-23', description: 'Canal dente 46' },
    // Pendentes semana atual
    { id: PY(14), clinic_id: CLINIC_ID, patient_id: PA(4),  appointment_id: AP(20), amount: 350.00, payment_method: 'credit_card', status: 'pending', due_date: '2026-05-27', paid_at: null, description: 'Restauração composta' },
    { id: PY(15), clinic_id: CLINIC_ID, patient_id: PA(5),  appointment_id: AP(22), amount: 180.00, payment_method: 'health_plan', status: 'pending', due_date: '2026-05-27', paid_at: null, description: 'Ajuste aparelho' },
    { id: PY(16), clinic_id: CLINIC_ID, patient_id: PA(6),  appointment_id: AP(24), amount: 900.00, payment_method: 'bank_slip',   status: 'pending', due_date: '2026-05-30', paid_at: null, description: 'Canal dente 36' },
    { id: PY(17), clinic_id: CLINIC_ID, patient_id: PA(7),  appointment_id: AP(26), amount: 180.00, payment_method: 'health_plan', status: 'pending', due_date: '2026-05-30', paid_at: null, description: 'Manutenção ortodôntica' },
    // Inadimplentes
    { id: PY(18), clinic_id: CLINIC_ID, patient_id: PA(19), appointment_id: null,   amount: 450.00, payment_method: 'bank_slip',   status: 'overdue', due_date: '2026-04-30', paid_at: null, description: 'Raspagem - parcela 1' },
    { id: PY(19), clinic_id: CLINIC_ID, patient_id: PA(21), appointment_id: null,   amount: 320.00, payment_method: 'bank_slip',   status: 'overdue', due_date: '2026-05-10', paid_at: null, description: 'Extração dente 28 - saldo' },
    { id: PY(20), clinic_id: CLINIC_ID, patient_id: PA(22), appointment_id: null,   amount: 280.00, payment_method: 'bank_slip',   status: 'overdue', due_date: '2026-05-15', paid_at: null, description: 'Consulta avaliação - pendente' },
    // Próximos meses
    { id: PY(21), clinic_id: CLINIC_ID, patient_id: PA(11), appointment_id: AP(32), amount: 280.00, payment_method: 'credit_card', status: 'pending', due_date: '2026-06-02', paid_at: null, description: 'Restauração' },
    { id: PY(22), clinic_id: CLINIC_ID, patient_id: PA(23), appointment_id: AP(33), amount: 3500.00,payment_method: 'bank_slip',   status: 'pending', due_date: '2026-06-10', paid_at: null, description: 'Instalação aparelho ortodôntico' },
  ]

  const { error: paymentsErr } = await supabase.from('payments').upsert(payments, { onConflict: 'id' })
  if (paymentsErr) { console.error('Pagamentos:', paymentsErr.message); return }
  console.log('✅ Pagamentos:', payments.length)

  // ── Despesas ───────────────────────────────────────────────────────────────
  const expenses = [
    { id: EX(1),  clinic_id: CLINIC_ID, description: 'Aluguel clínica',            category: 'Aluguel',      amount: 4500.00, due_date: '2026-05-05', paid_at: '2026-05-05', status: 'paid' },
    { id: EX(2),  clinic_id: CLINIC_ID, description: 'Energia elétrica',           category: 'Utilidades',   amount: 680.00,  due_date: '2026-05-10', paid_at: '2026-05-10', status: 'paid' },
    { id: EX(3),  clinic_id: CLINIC_ID, description: 'Internet e telefone',        category: 'Utilidades',   amount: 250.00,  due_date: '2026-05-10', paid_at: '2026-05-10', status: 'paid' },
    { id: EX(4),  clinic_id: CLINIC_ID, description: 'Material odontológico',      category: 'Materiais',    amount: 1850.00, due_date: '2026-05-15', paid_at: '2026-05-15', status: 'paid' },
    { id: EX(5),  clinic_id: CLINIC_ID, description: 'Folha de pagamento - Mai',   category: 'Pessoal',      amount: 8200.00, due_date: '2026-05-25', paid_at: null,         status: 'pending' },
    { id: EX(6),  clinic_id: CLINIC_ID, description: 'Manutenção equipamentos',    category: 'Manutenção',   amount: 420.00,  due_date: '2026-05-28', paid_at: null,         status: 'pending' },
    { id: EX(7),  clinic_id: CLINIC_ID, description: 'Contabilidade',              category: 'Serviços',     amount: 380.00,  due_date: '2026-05-30', paid_at: null,         status: 'pending' },
    { id: EX(8),  clinic_id: CLINIC_ID, description: 'Seguro clínica',             category: 'Seguros',      amount: 520.00,  due_date: '2026-04-20', paid_at: null,         status: 'overdue' },
    { id: EX(9),  clinic_id: CLINIC_ID, description: 'Aluguel clínica - Jun',      category: 'Aluguel',      amount: 4500.00, due_date: '2026-06-05', paid_at: null,         status: 'pending' },
    { id: EX(10), clinic_id: CLINIC_ID, description: 'Energia elétrica - Jun',     category: 'Utilidades',   amount: 680.00,  due_date: '2026-06-10', paid_at: null,         status: 'pending' },
    { id: EX(11), clinic_id: CLINIC_ID, description: 'Material descartável',       category: 'Materiais',    amount: 340.00,  due_date: '2026-06-15', paid_at: null,         status: 'pending' },
    { id: EX(12), clinic_id: CLINIC_ID, description: 'Folha de pagamento - Jun',   category: 'Pessoal',      amount: 8200.00, due_date: '2026-06-25', paid_at: null,         status: 'pending' },
    { id: EX(13), clinic_id: CLINIC_ID, description: 'Radiografias e exames',      category: 'Exames',       amount: 280.00,  due_date: '2026-05-20', paid_at: '2026-05-20', status: 'paid' },
  ]

  const { error: expensesErr } = await supabase.from('expenses').upsert(expenses, { onConflict: 'id' })
  if (expensesErr) { console.error('Despesas:', expensesErr.message); return }
  console.log('✅ Despesas:', expenses.length)

  // ── Próteses ───────────────────────────────────────────────────────────────
  // Schema: id, clinic_id, patient_id, professional_id, laboratory, type, status, requested_at, expected_at, notes
  const prosthetics = [
    { id: PR(1), clinic_id: CLINIC_ID, patient_id: PA(4),  professional_id: P1, type: 'Coroa cerâmica',  laboratory: 'Lab Dental Premium', status: 'installed',   requested_at: '2026-05-05', expected_at: '2026-05-15', notes: 'Dente 26 - cor A2 - finalizado' },
    { id: PR(2), clinic_id: CLINIC_ID, patient_id: PA(8),  professional_id: P3, type: 'PPR superior',    laboratory: 'Prótese & Arte',     status: 'returned',    requested_at: '2026-05-10', expected_at: '2026-05-22', notes: 'Aguardando instalação' },
    { id: PR(3), clinic_id: CLINIC_ID, patient_id: PA(12), professional_id: P1, type: 'Faceta em resina',laboratory: 'Lab Dental Premium', status: 'sent_to_lab', requested_at: '2026-05-20', expected_at: '2026-06-05', notes: 'Dentes 11,12,21,22 - cor B1 - urgência' },
    { id: PR(4), clinic_id: CLINIC_ID, patient_id: PA(18), professional_id: P1, type: 'Prótese total',   laboratory: 'Prótese & Arte',     status: 'requested',   requested_at: '2026-05-26', expected_at: '2026-06-15', notes: 'Aguardando molde definitivo' },
    { id: PR(5), clinic_id: CLINIC_ID, patient_id: PA(20), professional_id: P2, type: 'Aparelho fixo',   laboratory: 'OrthoLab',           status: 'sent_to_lab', requested_at: '2026-05-15', expected_at: '2026-05-30', notes: 'Mordida cruzada - caso especial' },
    { id: PR(6), clinic_id: CLINIC_ID, patient_id: PA(2),  professional_id: P2, type: 'Contenção',       laboratory: 'OrthoLab',           status: 'returned',    requested_at: '2026-05-08', expected_at: '2026-05-20', notes: 'Retorno agendado 27/05' },
    { id: PR(7), clinic_id: CLINIC_ID, patient_id: PA(24), professional_id: P1, type: 'Implante',        laboratory: 'Lab Dental Premium', status: 'installed',   requested_at: '2026-04-20', expected_at: '2026-05-10', notes: 'Dente 36 - cor A3 - pós-op ok' },
  ]

  const { error: prostheticsErr } = await supabase.from('prosthetics').upsert(prosthetics, { onConflict: 'id' })
  if (prostheticsErr) { console.error('Próteses:', prostheticsErr.message); return }
  console.log('✅ Próteses:', prosthetics.length)

  // ── Estoque ────────────────────────────────────────────────────────────────
  // Schema: id, clinic_id, name, category, quantity, min_quantity, unit
  const inventory = [
    { id: IV(1),  clinic_id: CLINIC_ID, name: 'Anestésico Lidocaína 2%',    category: 'Anestésicos',   quantity: 8,   min_quantity: 20, unit: 'tubetes' },
    { id: IV(2),  clinic_id: CLINIC_ID, name: 'Agulha curta 30G',           category: 'Descartáveis',  quantity: 45,  min_quantity: 50, unit: 'unid.' },
    { id: IV(3),  clinic_id: CLINIC_ID, name: 'Resina composta A2 (4g)',    category: 'Restauradores', quantity: 12,  min_quantity: 5,  unit: 'unid.' },
    { id: IV(4),  clinic_id: CLINIC_ID, name: 'Resina composta A3 (4g)',    category: 'Restauradores', quantity: 8,   min_quantity: 5,  unit: 'unid.' },
    { id: IV(5),  clinic_id: CLINIC_ID, name: 'Lima endodôntica #15',       category: 'Endodontia',    quantity: 6,   min_quantity: 10, unit: 'unid.' },
    { id: IV(6),  clinic_id: CLINIC_ID, name: 'Luvas P nitrilo (cx100)',    category: 'EPI',           quantity: 3,   min_quantity: 5,  unit: 'cx.' },
    { id: IV(7),  clinic_id: CLINIC_ID, name: 'Luvas M nitrilo (cx100)',    category: 'EPI',           quantity: 4,   min_quantity: 5,  unit: 'cx.' },
    { id: IV(8),  clinic_id: CLINIC_ID, name: 'Luvas G nitrilo (cx100)',    category: 'EPI',           quantity: 7,   min_quantity: 3,  unit: 'cx.' },
    { id: IV(9),  clinic_id: CLINIC_ID, name: 'Máscara cirúrgica (cx50)',   category: 'EPI',           quantity: 8,   min_quantity: 10, unit: 'cx.' },
    { id: IV(10), clinic_id: CLINIC_ID, name: 'Fio dental (rolo 100m)',     category: 'Higiene',       quantity: 15,  min_quantity: 5,  unit: 'unid.' },
    { id: IV(11), clinic_id: CLINIC_ID, name: 'Sugador descartável (pct)',  category: 'Descartáveis',  quantity: 5,   min_quantity: 8,  unit: 'pct.' },
    { id: IV(12), clinic_id: CLINIC_ID, name: 'Ionômero de vidro',          category: 'Restauradores', quantity: 9,   min_quantity: 3,  unit: 'unid.' },
    { id: IV(13), clinic_id: CLINIC_ID, name: 'Hipoclorito de sódio 1%',   category: 'Endodontia',    quantity: 3,   min_quantity: 5,  unit: 'L' },
    { id: IV(14), clinic_id: CLINIC_ID, name: 'Cimento de zinco',           category: 'Cimentos',      quantity: 6,   min_quantity: 2,  unit: 'unid.' },
    { id: IV(15), clinic_id: CLINIC_ID, name: 'Papel absorvente (pct)',     category: 'Descartáveis',  quantity: 20,  min_quantity: 10, unit: 'pct.' },
  ]

  const { error: inventoryErr } = await supabase.from('inventory_items').upsert(inventory, { onConflict: 'id' })
  if (inventoryErr) { console.error('Estoque:', inventoryErr.message); return }
  console.log('✅ Estoque:', inventory.length)

  console.log('\n🎉 Seed concluído com sucesso!')
  console.log('📊 Resumo:')
  console.log('   - 5 convênios')
  console.log('   - 4 profissionais')
  console.log('   - 25 pacientes')
  console.log('   - 43 agendamentos (semana passada + atual + próxima)')
  console.log('   - 22 pagamentos (pagos + pendentes + inadimplentes)')
  console.log('   - 13 despesas')
  console.log('   - 7 próteses (todos os status)')
  console.log('   - 15 itens de estoque (alguns abaixo do mínimo)')
}

seed().catch(console.error)
