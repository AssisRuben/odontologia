// Roteiro de verificação do sandbox do Asaas. Uso:
//   node --env-file=.env.local scripts/asaas-sandbox-probe.mjs <passo>
// Passos: customer single carne card min-value get receive-in-cash due-date delete
//         cancel-installment webhook fiscal-info invoice errors
// Só usa ASAAS_SANDBOX_API_KEY; grava respostas em tests/payments/fixtures/ com dados fictícios.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'https://api-sandbox.asaas.com/v3'
const KEY = process.env.ASAAS_SANDBOX_API_KEY
if (!KEY) { console.error('ASAAS_SANDBOX_API_KEY ausente'); process.exit(1) }
const FIX = path.resolve('tests/payments/fixtures')
fs.mkdirSync(FIX, { recursive: true })
const STATE_FILE = path.join(os.tmpdir(), 'asaas-probe-state.json')
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

function scrub(v, k = '') {
  if (Array.isArray(v)) return v.map((x) => scrub(x, k))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, scrub(vv, kk)]))
  if (typeof v === 'string') {
    if (v.includes('$aact') || v === KEY) return '[REDACTED]'
    if (/^(cpfCnpj|cpf)$/i.test(k)) return '52998224725'
    if (/^email$/i.test(k)) return 'paciente@exemplo.com'
    if (/phone$/i.test(k)) return '11999990000'
    if (/^(name|accountName|tradeName|companyName)$/i.test(k)) return 'Paciente Teste'
    if (/^(authToken|apiKey)$/i.test(k)) return '[REDACTED]'
  }
  return v
}
function write(name, status, body) {
  const out = scrub({ _status: status, ...(typeof body === 'object' && body !== null ? body : { _raw: body }) })
  fs.writeFileSync(path.join(FIX, `${name}.json`), JSON.stringify(out, null, 2) + '\n')
  console.log(`--- ${name} (HTTP ${status})\n${JSON.stringify(out, null, 2).slice(0, 1800)}`)
  return out
}
async function api(method, p, body, key = KEY) {
  const res = await fetch(BASE + p, {
    method,
    headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'odontologia-probe/1.0' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
function need(name) {
  if (!state[name]) { console.error(`falta estado: ${name}`); process.exit(1) }
  return state[name]
}

const steps = {
  async customer() {
    const r = await api('POST', '/customers', {
      name: 'Paciente Teste', cpfCnpj: '52998224725', email: 'paciente@exemplo.com',
      mobilePhone: '11999990000', externalReference: 'paciente-teste-1', notificationDisabled: true,
    })
    write('customer-create', r.status, r.json)
    state.customer = r.json.id; save()
  },
  async single() {
    const r = await api('POST', '/payments', {
      customer: need('customer'), billingType: 'UNDEFINED', value: 50, dueDate: '2026-11-20',
      description: 'Teste avulsa', externalReference: 'teste-avulsa-1',
      fine: { value: 2 }, interest: { value: 1 },
    })
    write('payment-single-undefined', r.status, r.json)
    state.single = r.json.id; save()
  },
  async carne() {
    const body = {
      customer: need('customer'), billingType: 'UNDEFINED', installmentCount: 3, totalValue: 100.0,
      dueDate: '2026-11-20', description: 'Teste carne', externalReference: 'teste-carne-1',
      fine: { value: 2 }, interest: { value: 1 },
    }
    let r = await api('POST', '/payments', body)
    if (r.status >= 400) {
      write('installment-carne-create-undefined-refused', r.status, r.json)
      r = await api('POST', '/payments', { ...body, billingType: 'BOLETO', externalReference: 'teste-carne-2' })
      state.carneBillingType = 'BOLETO'
    } else state.carneBillingType = 'UNDEFINED'
    write('installment-carne-create', r.status, r.json)
    state.carne = r.json.installment || r.json.id; save()
    const p = await api('GET', `/installments/${state.carne}/payments`)
    write('installment-carne-payments', p.status, p.json)
    state.carnePayments = (p.json.data || []).map((x) => x.id); save()
  },
  async card() {
    const r = await api('POST', '/payments', {
      customer: need('customer'), billingType: 'CREDIT_CARD', installmentCount: 3, totalValue: 90.0,
      dueDate: '2026-11-20', description: 'Teste cartao', externalReference: 'teste-cartao-1',
    })
    write('installment-card-create', r.status, r.json)
    state.card = r.json.installment || r.json.id; save()
    const p = await api('GET', `/installments/${state.card}/payments`)
    write('installment-card-payments', p.status, p.json)
    state.cardPayments = (p.json.data || []).map((x) => x.id); save()
  },
  async 'min-value'() {
    const cases = [
      ['single-4', { value: 4 }], ['installment-2x4', { installmentCount: 2, totalValue: 8 }],
      ['installment-2x2', { installmentCount: 2, totalValue: 4 }], ['installment-3x2', { installmentCount: 3, totalValue: 6 }],
      ['single-5', { value: 5 }], ['installment-2x5', { installmentCount: 2, totalValue: 10 }],
    ]
    for (const [label, body] of cases) {
      const r = await api('POST', '/payments', { customer: need('customer'), billingType: 'UNDEFINED', dueDate: '2026-11-20', description: 'min', ...body })
      console.log(label, r.status, JSON.stringify(scrub(r.json)).slice(0, 300))
      if (label === 'installment-2x4') write('min-value-error', r.status, r.json)
    }
  },
  async get() {
    const r = await api('GET', `/payments/${need('single')}`)
    write('payment-get-received', r.status, r.json) // sobrescrito pelo passo receive-in-cash
  },
  async 'receive-in-cash'() {
    const id = need('single')
    const r = await api('POST', `/payments/${id}/receiveInCash`, { paymentDate: '2026-11-04', value: 50, notifyCustomer: false })
    write('receive-in-cash', r.status, r.json)
    const g = await api('GET', `/payments/${id}`)
    write('payment-get-received', g.status, g.json)
  },
  async 'due-date'() {
    const ids = need('carnePayments')
    const r = await api('PUT', `/payments/${ids[1]}`, { dueDate: '2026-12-28' })
    write('update-due-date', r.status, r.json)
  },
  async delete() {
    const id = need('cardPayments')[2]
    const r = await api('DELETE', `/payments/${id}`)
    write('payment-delete', r.status, r.json)
    const g = await api('GET', `/payments/${id}`)
    write('payment-get-deleted', g.status, g.json)
  },
  async 'cancel-installment'() {
    const id = need('carne')
    const r = await api('DELETE', `/installments/${id}`)
    write('installment-cancel', r.status, r.json)
    for (const pid of state.carnePayments || []) {
      const g = await api('GET', `/payments/${pid}`)
      console.log('parcela', pid, g.status, g.json.status, g.json.deleted)
    }
  },
  async webhook() {
    const r = await api('POST', '/webhooks', {
      name: 'probe', url: 'https://example.com/api/webhooks/asaas', email: 'paciente@exemplo.com',
      enabled: true, interrupted: false, apiVersion: 3, authToken: crypto.randomBytes(32).toString('hex'),
      sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_UPDATED',
        'INVOICE_CREATED', 'INVOICE_UPDATED', 'INVOICE_SYNCHRONIZED', 'INVOICE_AUTHORIZED', 'INVOICE_PROCESSING_CANCELLATION', 'INVOICE_CANCELED', 'INVOICE_CANCELLATION_DENIED', 'INVOICE_ERROR'],
    })
    try {
      write('webhook-create', r.status, r.json)
    } finally {
      if (r.json && r.json.id) {
        const d = await api('DELETE', `/webhooks/${r.json.id}`)
        console.log('webhook removido', d.status, JSON.stringify(d.json))
      }
    }
  },
  // Extras: vencimento em avulsa e em carnê BOLETO; rotas alternativas de fiscalInfo
  async 'due-date-extra'() {
    const c = need('customer')
    const s1 = await api('POST', '/payments', { customer: c, billingType: 'UNDEFINED', value: 20, dueDate: '2026-11-20', description: 'due-extra' })
    const u1 = await api('PUT', '/payments/' + s1.json.id, { dueDate: '2026-12-05' })
    write('update-due-date-single', u1.status, u1.json)
    const b = await api('POST', '/payments', { customer: c, billingType: 'BOLETO', installmentCount: 2, totalValue: 40, dueDate: '2026-11-20', description: 'due-extra-boleto' })
    const lst = await api('GET', '/installments/' + b.json.installment + '/payments')
    const second = lst.json.data.find((x) => x.installmentNumber === 2)
    const u2 = await api('PUT', '/payments/' + second.id, { dueDate: '2026-12-28' })
    write('update-due-date-boleto-installment', u2.status, u2.json)
  },
  async 'fiscal-info'() {
    for (const p of ['/fiscalInfo/', '/fiscalInfo/municipalOptions', '/invoices?limit=1']) {
      const x = await api('GET', p)
      console.log(p, x.status, JSON.stringify(scrub(x.json)).slice(0, 300))
    }
    const r = await api('GET', '/fiscalInfo')
    write('fiscal-info', r.status, r.json)
  },
  async invoice() {
    const r = await api('POST', '/invoices', {
      payment: need('single'), serviceDescription: 'Servico odontologico', observations: 'teste',
      value: 50, deductions: 0, effectiveDate: '2026-11-04', externalReference: 'teste-nfse-1',
      municipalServiceCode: '8.02', municipalServiceName: 'Servicos odontologicos',
      taxes: { retainIss: false, iss: 2, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0 },
    })
    write('invoice-create', r.status, r.json)
  },
  async errors() {
    const a = await api('POST', '/customers', { name: 'Paciente Teste', cpfCnpj: '11111111111' })
    write('error-400', a.status, a.json)
    const b = await api('GET', '/customers?limit=1', undefined, 'chave-errada')
    write('error-401', b.status, b.json)
  },
}
const step = process.argv[2]
if (!steps[step]) { console.error('passos:', Object.keys(steps).join(' ')); process.exit(1) }
await steps[step]()
