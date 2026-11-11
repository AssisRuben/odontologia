// npm run demo — cria (ou atualiza) a conta de demonstração e recria todos os dados dela.
// Só mexe na clínica "Clínica Demonstração" do login demo@manual.local.
// Usa NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env.local.

import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { montarDados, snapshotAprovacao, novoToken } from './dados.mjs'
import { atualizarEnv } from './env.mjs'

const EMAIL = 'demo@manual.local'
const CLINICA = 'Clínica Demonstração'
const ARQ_ENV = path.resolve(import.meta.dirname, '../../.env.local')

// Apagadas nesta ordem (filhos antes dos pais), sempre filtrando pela clínica demo.
const LIMPEZA = [
  'messages', 'conversations', 'budget_events', 'budget_signatures', 'budget_links', 'health_receipts',
  'fiscal_invoices', 'insurance_guide_items', 'insurance_guides', 'insurance_batches', 'commission_closings',
  'inventory_movements', 'inventory_kit_items', 'inventory_kits', 'inventory_lots', 'inventory_items',
  'prosthetic_events', 'prosthetics', 'laboratories', 'payments', 'evolutions', 'anamneses', 'documents',
  'treatments', 'budgets', 'appointments', 'expenses', 'expense_recurrences', 'cash_balances',
  'insurance_plan_procedures', 'patients', 'insurance_plans', 'ai_usage',
]

function falhar(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

const { NEXT_PUBLIC_SUPABASE_URL: URL_SB, SUPABASE_SERVICE_ROLE_KEY: CHAVE } = process.env
if (!URL_SB || !CHAVE) falhar('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local')
const db = createClient(URL_SB, CHAVE, { auth: { persistSession: false, autoRefreshToken: false } })

async function ok(promessa, oque) {
  const { data, error } = await promessa
  if (error) falhar(`${oque}: ${error.message}`)
  return data
}

async function rpc(nome, args) {
  return ok(db.rpc(nome, args), `função ${nome}`)
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

async function acharUsuario() {
  for (let page = 1; ; page++) {
    const { users } = await ok(db.auth.admin.listUsers({ page, perPage: 1000 }), 'listar usuários')
    const u = users.find((x) => x.email === EMAIL)
    if (u || users.length < 1000) return u ?? null
  }
}

async function contaDemo(senha) {
  const existente = await acharUsuario()
  if (existente) {
    await ok(db.auth.admin.updateUserById(existente.id, { password: senha }), 'trocar a senha da conta demo')
    return existente.id
  }
  const { user } = await ok(db.auth.admin.createUser({
    email: EMAIL, password: senha, email_confirm: true,
    user_metadata: { name: 'Dra. Ana Beatriz Costa', clinic_name: CLINICA },
  }), 'criar a conta demo')
  return user.id
}

async function contarFora(clinicId) {
  const { count, error } = await db.from('patients').select('id', { count: 'exact', head: true }).neq('clinic_id', clinicId)
  if (error) falhar(`contar pacientes: ${error.message}`)
  return count
}

async function main() {
  const senha = randomBytes(18).toString('base64url')
  const userId = await contaDemo(senha)

  const dono = await ok(db.from('professionals').select('id, clinic_id').eq('user_id', userId).maybeSingle(), 'achar o profissional da conta demo')
  if (!dono) falhar('A conta demo não tem clínica. Apague o usuário demo@manual.local no Supabase e rode de novo.')
  const clinicId = dono.clinic_id
  const clinica = await ok(db.from('clinics').select('name').eq('id', clinicId).single(), 'ler a clínica demo')
  if (clinica.name !== CLINICA) falhar(`A clínica do login demo se chama "${clinica.name}", não "${CLINICA}". Nada foi apagado.`)

  const foraAntes = await contarFora(clinicId)

  console.log('Limpando a clínica demo…')
  for (const t of LIMPEZA) await ok(db.from(t).delete().eq('clinic_id', clinicId), `limpar ${t}`)
  await ok(db.from('professionals').delete().eq('clinic_id', clinicId).neq('id', dono.id), 'limpar professionals')

  const tuss = await ok(db.from('tuss_procedures').select('code, name').order('code').limit(5), 'ler TUSS')
  const glosa = (await ok(db.from('glosa_reasons').select('code').order('code').limit(1), 'ler motivos de glosa'))[0]?.code ?? null
  const modelo = (await ok(db.from('anamnesis_templates').select('id, questions').eq('clinic_id', clinicId).order('created_at').limit(1), 'ler modelo de anamnese'))[0]

  const hoje = hojeSaoPaulo()
  const demo = montarDados({
    hoje, clinicId, donoId: dono.id, userId, uid: randomUUID,
    tuss, glosa, templateId: modelo?.id, perguntas: modelo?.questions ?? [],
  })

  console.log('Gravando os dados…')
  await ok(db.from('clinics').update(demo.clinica).eq('id', clinicId), 'atualizar a clínica')
  await ok(db.from('professionals').update(demo.dono).eq('id', dono.id), 'atualizar o profissional dono')
  for (const [tabela, linhas] of demo.insercoes) {
    for (let i = 0; i < linhas.length; i += 500) await ok(db.from(tabela).insert(linhas.slice(i, i + 500)), `gravar ${tabela}`)
  }

  for (const id of demo.pularMaterial) await rpc('treatment_material_skip', { p_clinic_id: clinicId, p_treatment_id: id })

  // Orçamentos: o status só muda pelas funções do banco
  const nomes = Object.fromEntries((await ok(db.from('professionals').select('id, name').eq('clinic_id', clinicId), 'ler profissionais')).map((p) => [p.id, p.name]))
  let tokenExemplo = ''
  for (const o of demo.orcamentos) {
    if (o.acao === 'rascunho') continue
    const token = novoToken()
    if (o.acao === 'enviar') tokenExemplo = token
    const r = await rpc('send_budget', { p_budget_id: o.id, p_token: token, p_validity_days: 30, p_actor: userId })
    if (r !== 'ok') falhar(`enviar orçamento: ${r}`)
    if (o.acao === 'ver') {
      // Enviado há 4 dias e visto há 3: cai em "Para ligar" (visto há 2 dias ou mais, sem resposta)
      const dias = (n) => new Date(Date.now() - n * 86400000).toISOString()
      await ok(db.from('budgets').update({ sent_at: dias(4), viewed_at: dias(3) }).eq('id', o.id), 'marcar orçamento como visto')
      await ok(db.from('budget_links').update({ created_at: dias(4) }).eq('budget_id', o.id).is('revoked_at', null), 'datar o link')
      await ok(db.from('budget_links').update({ view_count: 2 }).eq('budget_id', o.id).is('revoked_at', null), 'contar visualização')
      await ok(db.from('budget_events').insert({ budget_id: o.id, clinic_id: clinicId, type: 'viewed' }), 'registrar visualização')
    }
    if (o.acao === 'perder') {
      const r2 = await rpc('reject_budget', { p_budget_id: o.id, p_link_id: null, p_reason: o.motivo, p_note: o.nota, p_actor: userId, p_status: 'rejected' })
      if (r2 !== 'ok') falhar(`marcar orçamento como perdido: ${r2}`)
    }
    if (o.acao === 'aprovar') {
      const b = await ok(db.from('budgets').select('created_at, valid_until').eq('id', o.id).single(), 'ler orçamento')
      const assinadoEm = new Date().toISOString()
      const snapshot = snapshotAprovacao({
        clinica: CLINICA, paciente: o.paciente, dentista: nomes[o.dentista] ?? null, orcamentoId: o.id,
        criadoEm: b.created_at, validade: b.valid_until, itens: o.itens, assinante: o.assinante, assinadoEm,
      })
      const r3 = await rpc('approve_budget', {
        p_budget_id: o.id, p_link_id: null, p_item_ids: o.itens.map((i) => i.id), p_approved_total: o.total,
        p_signature: {
          provider: 'reception', provider_ref: null, signer_name: o.assinante.nome, signer_cpf: o.assinante.cpf,
          snapshot, document_hash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
          ip: null, user_agent: 'npm run demo', signed_at: assinadoEm, approved_by: userId,
        },
        p_actor: userId,
      })
      if (r3 !== 'ok') falhar(`aprovar orçamento: ${r3}`)
    }
  }

  for (const r of demo.recorrencias) await rpc('create_expense_recurrence', { p_clinic_id: clinicId, p_data: r })
  await rpc('generate_recurring_expenses', { p_clinic_id: clinicId })

  const { lote } = demo
  const n = await rpc('assign_batch_items', { p_clinic_id: clinicId, p_batch_id: lote.id, p_item_ids: lote.itemIds })
  if (n !== lote.itemIds.length) falhar(`lote de convênio: ${n} de ${lote.itemIds.length} itens entraram`)
  await rpc('send_insurance_batch', { p_clinic_id: clinicId, p_batch_id: lote.id, p_protocol: lote.protocolo, p_sent_at: lote.enviadoEm })
  await rpc('register_batch_payment', { p_clinic_id: clinicId, p_batch_id: lote.id, p_paid_at: lote.pagoEm, p_deposit: lote.deposito, p_items: lote.itens })

  const foraDepois = await contarFora(clinicId)
  if (foraDepois !== foraAntes) falhar(`Pacientes de outras clínicas mudaram (${foraAntes} → ${foraDepois}). Verifique!`)

  const texto = fs.existsSync(ARQ_ENV) ? fs.readFileSync(ARQ_ENV, 'utf8') : ''
  // MANUAL_ORCAMENTO_TOKEN: link de um orçamento enviado, para a captura da página do paciente
  fs.writeFileSync(ARQ_ENV, atualizarEnv(texto, { MANUAL_EMAIL: EMAIL, MANUAL_SENHA: senha, MANUAL_ORCAMENTO_TOKEN: tokenExemplo }))

  const total = demo.insercoes.reduce((s, [, l]) => s + l.length, 0)
  console.log(`\n✓ Clínica demo pronta: ${total} registros (dados em volta de ${hoje}).`)
  console.log(`  Login: ${EMAIL} — senha gravada em MANUAL_SENHA no .env.local.`)
  console.log(`  Outras clínicas não foram alteradas (${foraDepois} pacientes fora da demo).`)
}

main()
