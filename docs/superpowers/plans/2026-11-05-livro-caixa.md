# Livro-caixa, Carnê-Leão e Receita Saúde: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dentista pessoa física cadastra despesas com comprovante, vê o livro-caixa do mês (receitas de pacientes, despesas dedutíveis por grupo do Carnê-Leão, resultado), controla os recibos do Receita Saúde e baixa um pacote .zip para o contador.

**Architecture:** Livro-caixa calculado na hora: lógica pura em `src/lib/livro-caixa/*` (categorias, mês, apuração, exportação), alimentada por um repositório Supabase e servida por rotas `src/app/api/livro-caixa/*`. Despesas e comprovantes são gravados pela tela direto no Supabase (RLS + bucket privado). Recibo emitido fica na tabela própria `health_receipts`.

**Tech Stack:** Next.js 16 (route handlers), React 19, Supabase (Postgres + RLS + Storage), Vitest, `pdf-lib`, `fflate`.

**Spec:** `docs/superpowers/specs/2026-11-05-livro-caixa-design.md`

## Global Constraints

- Next.js 16: antes de escrever route handlers, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (`params` é `Promise`; use `RouteContext<'/api/livro-caixa/[mes]'>`; rode `npx next typegen` se o tipo não existir).
- Rotas autenticadas usam `getCurrentClinic()` (`src/lib/auth/currentClinic.ts`): 401 `{ error: 'Não autorizado.' }` sem sessão. Dados lidos com o cliente do usuário (`createClient` de `src/lib/supabase/server.ts`, RLS), sempre filtrando também por `clinic_id`. Nada de service role neste projeto.
- Valores em **centavos inteiros** na lógica (`toCents`/`fromCents` de `src/lib/payments/money.ts`).
- Data de um lançamento = `fromDbPaidAt(paid_at)` (`src/lib/payments/dates.ts`); gravação de `paid_at` de despesas com `toDbPaidAt('YYYY-MM-DD')`.
- CPF: `normalizeCpf` de `src/lib/payments/cpf.ts`. CPF inválido conta como ausente.
- Códigos de categoria, grupos e rótulos: exatamente os da spec §5.
- Bucket `expense-receipts` privado; caminho `<clinic_id>/<expense_id>/<uuid>.<ext>`; até 10 MB; tipos `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Links temporários com validade de 3600 s.
- Limite de comprovantes no pacote: 100 MB (`100 * 1024 * 1024` bytes).
- CSV: UTF-8 com BOM (`﻿`), separador `;`, quebra de linha `\r\n`, valores `1234,56` (sem separador de milhar), datas `DD/MM/AAAA`; campos com `;`, `"` ou quebra de linha entre aspas, com `"` duplicadas.
- Aviso fixo do livro-caixa: "Valores para conferência. O cálculo oficial do imposto é feito no Carnê-Leão Web."
- Migração `supabase/2026-11-05-livro-caixa.sql` re-executável (`IF NOT EXISTS`, `DROP ... IF EXISTS`), espelhada em `supabase/schema.sql`.
- Texto em português do Brasil, estilo das telas atuais (`#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).

## Review Focus

1. **CPF do responsável ou do paciente gravado com pontuação ou inválido** (`'123.456.789-09'`, `'111.111.111-11'`): com pontuação vale normalmente; inválido conta como "sem CPF" e gera alerta. → Task 3 (`normalizes formatted payer cpf`, `invalid cpf counts as missing`).
2. **Pagamento estornado depois de marcado o recibo:** some do resultado e da lista de recibos, mesmo com linha em `health_receipts`. → Task 3 (`refunded payment with issued receipt is excluded`).
3. **Descrição com `;`, aspas ou quebra de linha na planilha:** não pode desalinhar colunas no Excel. → Task 4 (`quotes fields with separator, quotes and newlines`).
4. **Despesa com categoria fora da lista** (linha antiga não migrada, digitação via API): tratada como `outras`, não dedutível, sem quebrar a apuração. → Task 3 (`unknown category falls back to outras`).
5. **Documento antigo do paciente com URL pública** depois que o bucket vira privado: continua abrindo. → Task 6 (`extracts storage path from legacy public url`).

---

## File Structure

```
supabase/2026-11-05-livro-caixa.sql            (novo) migração
supabase/schema.sql                            (mod) espelho
src/types/index.ts                             (mod) Expense, Patient, HealthReceipt
src/lib/livro-caixa/categorias.ts              (novo) lista §5 e rótulos
src/lib/livro-caixa/mes.ts                     (novo) validação e navegação de mês
src/lib/livro-caixa/apuracao.ts                (novo) buildLedger (puro)
src/lib/livro-caixa/exportacao.ts              (novo) CSV, PDF, ZIP, nomes de arquivo
src/lib/livro-caixa/despesas.ts                (novo) validação de despesa e de comprovante (puro)
src/lib/livro-caixa/recibos.ts                 (novo) marcar/desmarcar recibo (deps injetadas)
src/lib/livro-caixa/repo.ts                    (novo) consultas Supabase
src/lib/storage/documentos.ts                  (novo) caminho do documento e link temporário
src/app/api/livro-caixa/[mes]/route.ts         (novo) GET ledger
src/app/api/livro-caixa/[mes]/exportar/route.ts (novo) GET zip
src/app/api/livro-caixa/recibos/[paymentId]/route.ts (novo) POST/DELETE
src/components/financeiro/ListaDespesas.tsx    (novo)
src/components/financeiro/ModalDespesa.tsx     (novo)
src/components/financeiro/LivroCaixa.tsx       (novo)
src/app/(dashboard)/financeiro/page.tsx        (mod) abas Despesas e Livro-caixa
src/components/paciente/ModalEditarPaciente.tsx (mod) responsável pelo pagamento
src/components/paciente/TabDocumentos.tsx      (mod) bucket privado
tests/livro-caixa/*.test.ts, tests/storage/documentos.test.ts, tests/supabase/migration.test.ts (mod)
README.md                                      (mod) seção Livro-caixa
```

---

### Task 1: Banco de dados e tipos

**Files:**
- Create: `supabase/2026-11-05-livro-caixa.sql`
- Modify: `supabase/schema.sql`, `src/types/index.ts`
- Test: `tests/supabase/migration.test.ts`

**Interfaces:**
- Produces (tipos em `src/types/index.ts`):
  - `export type ExpenseCategory = 'aluguel'|'contas'|'material'|'laboratorio'|'servicos'|'manutencao'|'marketing'|'conselho'|'iptu_taxas'|'tarifas'|'salarios'|'emolumentos'|'equipamentos'|'reformas'|'cursos'|'outras'`
  - `export type DeductionGroup = 'custeio'|'pessoal'|'emolumentos'`
  - `Expense` ganha `category: ExpenseCategory`, `deduction_group: DeductionGroup | null`, `payment_method?: PaymentMethod | null`, `professional_id?: string | null`, `notes?: string | null`, `receipt_path?: string | null`, `receipt_name?: string | null`, `receipt_size?: number | null`, `receipt_type?: string | null`, `updated_at: string`.
  - `Patient` ganha `payer_name?: string | null`, `payer_cpf?: string | null`.
  - `export interface HealthReceipt { payment_id: string; clinic_id: string; issued_at: string; issued_by: string | null }`

- [ ] **Step 1: Escrever os testes da migração** em `tests/supabase/migration.test.ts`, num `describe.each(['2026-11-05-livro-caixa.sql', 'schema.sql'])`:
  - `expenses aceita só as categorias da lista`: contém `CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','outras'))`.
  - `deduction_group com os três grupos`: contém `CHECK (deduction_group IN ('custeio','pessoal','emolumentos'))`.
  - `health_receipts com RLS ligada`: contém `CREATE TABLE IF NOT EXISTS health_receipts` e `ALTER TABLE health_receipts ENABLE ROW LEVEL SECURITY;`.
  - `bucket de comprovantes privado`: contém `('expense-receipts', 'expense-receipts', false)`.
  - `bucket de documentos privado`: contém `UPDATE storage.buckets SET public = false WHERE id = 'anneOdonto';` (na migração) / `VALUES ('anneOdonto', 'anneOdonto', false)` (no schema): teste por arquivo.
  - Só na migração: `migra categorias antigas para outras antes do CHECK` (o `UPDATE expenses SET ... category = 'outras'` aparece antes do `ADD CONSTRAINT expenses_category_check`) e `converte file_url público em caminho` (contém `/storage/v1/object/public/anneOdonto/`).

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/supabase/migration.test.ts` → FAIL (arquivo não existe).

- [ ] **Step 3: Escrever a migração** seguindo spec §6, nesta ordem:
  1. `expenses`: colunas novas (`ADD COLUMN IF NOT EXISTS`); `UPDATE` que move `category` fora da lista para `notes` (concatenando com `' · '` se já houver nota) e define `category = 'outras'` (inclui `NULL`); `ALTER COLUMN category SET DEFAULT 'outras'`, `SET NOT NULL`; `DROP CONSTRAINT IF EXISTS expenses_category_check` + `ADD CONSTRAINT expenses_category_check CHECK (...)`; constraint de `deduction_group`; o preenchimento inicial de `deduction_group` (grupo padrão da categoria, via `CASE category WHEN ... END`) roda **só quando a coluna é criada**: um bloco `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'deduction_group') THEN ALTER TABLE ... ADD COLUMN ...; UPDATE ...; END IF; END $$;`, para que rodar de novo não sobrescreva escolhas do usuário; `payment_method` com CHECK dos valores de pagamento sem `convenio`.
  2. `patients`: `payer_name`, `payer_cpf`.
  3. `health_receipts` (spec §6), RLS, policies `health_receipts_select`, `health_receipts_insert` (`WITH CHECK (clinic_id IN (SELECT user_clinic_ids()) AND EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id AND p.clinic_id = health_receipts.clinic_id))`), `health_receipts_delete`.
  4. Storage: bucket `expense-receipts` privado + policies `expense_receipts_select/insert/delete` copiando as de `anneOdonto`; `UPDATE storage.buckets SET public = false WHERE id = 'anneOdonto';`; `UPDATE documents SET file_url = split_part(file_url, '/storage/v1/object/public/anneOdonto/', 2) WHERE file_url LIKE '%/storage/v1/object/public/anneOdonto/%';` (remover `?query` se houver).
  Cabeçalho com "Como aplicar" igual ao da migração do Asaas. Espelhar no `schema.sql` (estado final, sem os UPDATEs de migração; bucket `anneOdonto` criado com `false`).

- [ ] **Step 4: Atualizar `src/types/index.ts`** com os tipos de Interfaces.

- [ ] **Step 5: Verificar** — `npx vitest run tests/supabase` PASS; `npx tsc --noEmit -p .` sem erros novos (telas que usam `Expense.category` como texto livre ainda compilam; se não, ajuste mínimo).

- [ ] **Step 6: Commit** — `git commit -m "feat(livro-caixa): migração de despesas, recibos e buckets privados"`

---

### Task 2: Categorias e mês (puro)

**Files:**
- Create: `src/lib/livro-caixa/categorias.ts`, `src/lib/livro-caixa/mes.ts`
- Test: `tests/livro-caixa/categorias.test.ts`, `tests/livro-caixa/mes.test.ts`

**Interfaces:**
- Produces:
  - `export const CATEGORIES: readonly { code: ExpenseCategory; label: string; group: DeductionGroup | null }[]` (ordem da spec §5)
  - `export function toCategory(code: string | null | undefined): ExpenseCategory` (desconhecido → `'outras'`)
  - `export function categoryLabel(code: string | null | undefined): string`
  - `export function defaultGroup(code: ExpenseCategory): DeductionGroup | null`
  - `export function groupLabel(g: DeductionGroup | null): string` (`'Despesas de custeio' | 'Salários e encargos' | 'Emolumentos' | 'Não dedutível'`)
  - `export function parseMonth(s: string): { year: number; month: number } | null` (aceita só `/^\d{4}-(0[1-9]|1[0-2])$/`)
  - `export function monthRange(ym: string): { first: string; last: string }` (`'2026-02'` → `'2026-02-01'`, `'2026-02-28'`)
  - `export function shiftMonth(ym: string, delta: number): string`
  - `export function monthLabel(ym: string): string` (`'2026-11'` → `'novembro de 2026'`)
  - `export function inMonth(ymd: string | null, ym: string): boolean`

- [ ] **Step 1: Testes**
  - `every category has label and group as in spec`: 16 itens; `defaultGroup('salarios') === 'pessoal'`, `defaultGroup('emolumentos') === 'emolumentos'`, `defaultGroup('equipamentos') === null`, `defaultGroup('tarifas') === 'custeio'`.
  - `toCategory('Material')`, `toCategory(null)` → `'outras'`; `toCategory('material')` → `'material'`.
  - `groupLabel(null) === 'Não dedutível'`.
  - `parseMonth('2026-13')`, `parseMonth('2026-1')`, `parseMonth('abc')` → `null`; `parseMonth('2026-11')` → `{ year: 2026, month: 11 }`.
  - `monthRange('2028-02').last === '2028-02-29'`; `monthRange('2026-12').last === '2026-12-31'`.
  - `shiftMonth('2026-12', 1) === '2027-01'`; `shiftMonth('2026-01', -1) === '2025-12'`.
  - `monthLabel('2026-03') === 'março de 2026'`.
  - `inMonth('2026-11-30', '2026-11')` true; `inMonth('2026-12-01', '2026-11')` false; `inMonth(null, '2026-11')` false.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/livro-caixa` → FAIL.
- [ ] **Step 3: Implementar** (sem dependência de fuso: tudo em texto `YYYY-MM-DD`).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(livro-caixa): categorias e utilitários de mês`

---

### Task 3: Apuração do mês (puro)

**Files:**
- Create: `src/lib/livro-caixa/apuracao.ts`
- Test: `tests/livro-caixa/apuracao.test.ts`

**Interfaces:**
- Consumes: Task 2; `toCents`, `fromDbPaidAt`, `normalizeCpf`.
- Produces:
```ts
export interface LedgerPaymentIn { id: string; patient_id: string; amount: number; net_amount: number | null; status: string; payment_method: string | null; paid_at: string | null; description: string | null }
export interface LedgerExpenseIn { id: string; description: string; amount: number; category: string | null; deduction_group: string | null; status: string; paid_at: string | null; receipt_path: string | null; receipt_name: string | null; receipt_size: number | null }
export interface LedgerPatientIn { id: string; name: string; cpf: string | null; payer_name: string | null; payer_cpf: string | null }
export interface LedgerInput { month: string; payments: LedgerPaymentIn[]; expenses: LedgerExpenseIn[]; patients: LedgerPatientIn[]; receipts: { payment_id: string; issued_at: string }[] }
export type RowKind = 'receita' | 'convenio' | 'despesa' | 'tarifa'
export interface LedgerRow { kind: RowKind; refId: string; date: string; description: string; category: string | null; group: DeductionGroup | null; amountCents: number; payerName: string | null; payerCpf: string | null; patientName: string | null; receiptIssued: boolean | null; attachmentPath: string | null; attachmentName: string | null; attachmentSize: number | null }
export interface ReceiptItem { paymentId: string; date: string; amountCents: number; payerName: string; payerCpf: string | null; patientId: string; patientName: string; patientCpf: string | null; issuedAt: string | null }
export interface LedgerTotals { patientRevenueCents: number; insuranceRevenueCents: number; custeioCents: number; feesCents: number; pessoalCents: number; emolumentosCents: number; deductibleCents: number; nonDeductibleCents: number; resultCents: number }
export interface LedgerAlerts { pendingReceipts: number; receiptsWithoutCpf: number; deductibleWithoutAttachment: number }
export interface Ledger { month: string; totals: LedgerTotals; rows: LedgerRow[]; receipts: ReceiptItem[]; alerts: LedgerAlerts }
export function buildLedger(input: LedgerInput): Ledger
```
Regras: spec §7. `custeioCents` **não** inclui tarifas; `deductibleCents = custeio + fees + pessoal + emolumentos`; `resultCents = patientRevenue - deductible`. `group` de despesa = `deduction_group` se válido, senão `null`; categoria passa por `toCategory`. Linha `tarifa`: uma por pagamento com tarifa > 0, `group: 'custeio'`, descrição `Tarifa de cobrança: <descrição do pagamento ou "Pagamento">`. Paciente ausente da lista → nome `'Paciente não encontrado'`, CPF `null`. `rows` ordenadas por data e depois por tipo (`receita, convenio, tarifa, despesa`); `receipts` por data. `pendingReceipts` = recibos sem `issuedAt`; `receiptsWithoutCpf` = recibos com `payerCpf === null`; `deductibleWithoutAttachment` = despesas do mês com grupo não nulo e `receipt_path` nulo.

- [ ] **Step 1: Testes** (fábricas `pay()`, `exp()`, `pat()` com padrões; mês `'2026-11'`):
  - `counts paid payments by paid_at date`: pago em `'2026-11-30T12:00:00+00:00'` entra; `'2026-12-01T12:00:00+00:00'` não; `'2026-10-31T12:00:00+00:00'` não.
  - `excludes pending, overdue, cancelled and refunded`.
  - `refunded payment with issued receipt is excluded` (status `refunded` + linha em `receipts` → não aparece em `receipts` nem no total).
  - `separates insurance revenue`: `payment_method: 'convenio'` soma em `insuranceRevenueCents`, fora de `resultCents` e de `receipts`.
  - `fees from net_amount`: amount 10, net 9.01 → `feesCents === 99`; net `null` → 0; net ≥ amount → 0.
  - `groups expenses and respects override`: `aluguel` com `deduction_group: 'custeio'`; `material` com `deduction_group: null` (troca do usuário) → não dedutível; `salarios`/`pessoal`; `emolumentos`.
  - `unknown category falls back to outras` (`category: 'Material antigo'`, `deduction_group: null` → `nonDeductibleCents`, linha com `category: 'outras'`).
  - `unpaid expense is ignored`.
  - `negative result is kept` (despesa maior que receita → `resultCents < 0`).
  - `sums in cents without float drift`: três pagamentos de `0.1`, `0.2`, `0.3` → `patientRevenueCents === 60`.
  - `payer is responsible when payer_cpf is valid, else patient`.
  - `normalizes formatted payer cpf` (`'529.982.247-25'` → `'52998224725'`).
  - `invalid cpf counts as missing` (`payer_cpf: '111.111.111-11'`, `cpf: null` → `payerCpf: null`, `receiptsWithoutCpf === 1`; inválido no responsável cai para o CPF do paciente se válido).
  - `issued receipts carry issuedAt and lower pendingReceipts`.
  - `deductible expense without attachment raises alert`; não dedutível sem comprovante não conta.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `buildLedger`.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(livro-caixa): apuração mensal`

---

### Task 4: Exportação (CSV, PDF, ZIP)

**Files:**
- Create: `src/lib/livro-caixa/exportacao.ts`
- Modify: `package.json` (`npm install pdf-lib fflate`)
- Test: `tests/livro-caixa/exportacao.test.ts`

**Interfaces:**
- Consumes: `Ledger`, `LedgerRow` (Task 3); `categoryLabel`, `groupLabel`, `monthLabel` (Task 2).
- Produces:
  - `export const MAX_ATTACHMENTS_BYTES = 100 * 1024 * 1024`
  - `export function toCsv(ledger: Ledger): string` — cabeçalho exato `Data;Tipo;Descrição;Categoria;Grupo Carnê-Leão;Valor;Pagador;CPF do pagador;Paciente;Recibo emitido;Comprovante`; Tipo: `Receita de paciente | Convênio | Despesa | Tarifa de cobrança`; Recibo emitido: `Sim | Não | ''` (vazio fora de receita); Comprovante: nome do arquivo no zip ou vazio. Despesas aparecem com valor positivo.
  - `export function attachmentFileName(row: LedgerRow): string` — `comprovantes/<AAAA-MM-DD>-<slug da descrição, máx. 40>-<8 primeiros do refId>.<ext do attachmentName ou do path>`; slug sem acento, minúsculo, `[^a-z0-9]+` → `-`.
  - `export async function toPdf(ledger: Ledger, clinicName: string): Promise<Uint8Array>` — pdf-lib, fonte `StandardFonts.Helvetica` (texto com acentos via WinAnsi; trocar caracteres fora do WinAnsi por `?`), A4, título `Livro-caixa — <monthLabel>`, nome da clínica, quadro de totais (mesmos rótulos da tela), contagem de recibos emitidos/pendentes, aviso fixo da Global Constraints, depois as linhas (data, tipo, descrição, valor) com quebra de página.
  - `export function selectAttachments(rows: LedgerRow[]): { included: LedgerRow[]; skipped: boolean }` — linhas com `attachmentPath`; se a soma de `attachmentSize` (nulo = 0) passar de `MAX_ATTACHMENTS_BYTES`, `included: []`, `skipped: true`.
  - `export function toZip(files: Record<string, Uint8Array>): Uint8Array` — `zipSync` do fflate.
  - `export const SKIPPED_NOTE = 'Os comprovantes deste mês passam de 100 MB e não foram incluídos. Baixe-os pela tela de Despesas.'` (vai em `LEIA-ME.txt`).

- [ ] **Step 1: Testes**
  - `csv starts with BOM and header`.
  - `csv uses comma decimals and dd/mm/yyyy` (`123456` centavos → `1234,56`; `'2026-11-05'` → `05/11/2026`).
  - `quotes fields with separator, quotes and newlines` (descrição `Ana; "filha"\nok` → `"Ana; ""filha""\nok"`).
  - `keeps accents` (`Descrição` e `Não` presentes no texto).
  - `attachmentFileName slugs and keeps extension` (`'Conta de luz — Março'`, attachmentName `foto.JPG` → termina com `.jpg`... use extensão em minúsculas; começa com `comprovantes/2026-11-05-conta-de-luz-marco-`).
  - `selectAttachments skips all above 100 MB`.
  - `toPdf returns a pdf` (bytes começam com `%PDF`).
  - `toZip contains given names` (`unzipSync` lista `resumo.pdf`, `lancamentos.csv`, `comprovantes/x.pdf`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Instalar libs e implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(livro-caixa): exportação em CSV, PDF e ZIP`

---

### Task 5: Repositório e rotas

**Files:**
- Create: `src/lib/livro-caixa/recibos.ts`, `src/lib/livro-caixa/repo.ts`, `src/app/api/livro-caixa/[mes]/route.ts`, `src/app/api/livro-caixa/[mes]/exportar/route.ts`, `src/app/api/livro-caixa/recibos/[paymentId]/route.ts`
- Test: `tests/livro-caixa/recibos.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
```ts
// recibos.ts
export interface ReceiptDeps {
  getPayment(clinicId: string, paymentId: string): Promise<{ id: string; status: string; payment_method: string | null } | null>
  insertReceipt(row: { payment_id: string; clinic_id: string; issued_by: string }): Promise<void> // ignora duplicata (23505)
  deleteReceipt(clinicId: string, paymentId: string): Promise<void>
}
export type ReceiptResult = { status: 200; body: { ok: true } } | { status: 404 | 422; body: { error: string } }
export async function markReceipt(clinicId: string, userId: string, paymentId: string, deps: ReceiptDeps): Promise<ReceiptResult>
export async function unmarkReceipt(clinicId: string, paymentId: string, deps: ReceiptDeps): Promise<ReceiptResult>
// repo.ts (cliente do usuário: SupabaseClient de src/lib/supabase/server.ts)
export async function loadLedgerInput(supabase: SupabaseClient, clinicId: string, month: string): Promise<LedgerInput>
export async function loadClinicName(supabase: SupabaseClient, clinicId: string): Promise<string>
export async function downloadAttachment(supabase: SupabaseClient, path: string): Promise<Uint8Array>
export function createReceiptDeps(supabase: SupabaseClient): ReceiptDeps
```
`loadLedgerInput`: pagamentos com `status in ('paid','refunded')` e `paid_at` entre `toDbPaidAt(first)` menos 1 dia e `toDbPaidAt(last)` mais 1 dia (filtro final por `inMonth` fica em `buildLedger`); despesas `status = 'paid'` no mesmo intervalo; pacientes `in` os `patient_id` encontrados (em lotes de 200); recibos `in` os ids dos pagamentos. Use `fetchAll`/paginação de `src/lib/messaging/cycleData.ts` para pagamentos e despesas.

Rotas (todas `export const dynamic = 'force-dynamic'`):
- `GET /api/livro-caixa/[mes]`: `parseMonth` falha → 400 `{ error: 'Mês inválido' }`; sem clínica → 401; devolve `buildLedger(...)`.
- `GET /api/livro-caixa/[mes]/exportar`: monta `resumo.pdf`, `lancamentos.csv`, comprovantes (`selectAttachments`; se `skipped`, `LEIA-ME.txt` com `SKIPPED_NOTE` e header `X-Comprovantes-Omitidos: 1`); um comprovante que falhar no download é omitido e listado no `LEIA-ME.txt` (`Não foi possível incluir: <nome>`). Resposta `application/zip`, `Content-Disposition: attachment; filename="livro-caixa-AAAA-MM.zip"`. Erro geral → 500 `{ error: 'Não foi possível gerar o pacote. Tente novamente.' }`.
- `POST`/`DELETE /api/livro-caixa/recibos/[paymentId]`: chamam `markReceipt`/`unmarkReceipt`.

- [ ] **Step 1: Testes de `recibos.ts`**
  - `marks paid patient payment` → 200 e `insertReceipt` chamado com `{ payment_id, clinic_id, issued_by }`.
  - `404 when payment not found` (deps devolve `null`) → `{ error: 'Pagamento não encontrado' }`.
  - `422 for insurance or unpaid` (`payment_method: 'convenio'`; `status: 'pending'`) → `{ error: 'Este pagamento não precisa de recibo no Receita Saúde' }`.
  - `unmark deletes and returns 200`; `unmark 404 when payment not found`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `recibos.ts`, `repo.ts` e as três rotas.**
- [ ] **Step 4: Verificar** — testes PASS; `npx tsc --noEmit -p .`; `npm run build` compila as rotas.
- [ ] **Step 5: Commit** — `feat(livro-caixa): rotas do livro-caixa, recibos e exportação`

---

### Task 6: Documentos do paciente em bucket privado

**Files:**
- Create: `src/lib/storage/documentos.ts`
- Modify: `src/components/paciente/TabDocumentos.tsx`
- Test: `tests/storage/documentos.test.ts`

**Interfaces:**
- Produces:
  - `export function documentPath(fileUrl: string): string` — se contém `/storage/v1/object/public/anneOdonto/`, devolve a parte depois (sem `?query`, com `decodeURIComponent`); senão devolve o valor como está.
  - `export async function signedUrls(supabase: SupabaseClient, bucket: string, paths: string[]): Promise<Record<string, string>>` — `createSignedUrls(paths, 3600)`; caminhos que falharem ficam fora do mapa.

- [ ] **Step 1: Testes** — `extracts storage path from legacy public url` (`https://x.supabase.co/storage/v1/object/public/anneOdonto/c1/p1/a%20b.pdf?t=1` → `c1/p1/a b.pdf`); `keeps plain path`; `signedUrls maps paths` (cliente falso).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar e ajustar `TabDocumentos.tsx`**: upload grava `file_url: path` (sem `getPublicUrl`); ao carregar a lista, gerar links com `signedUrls` e usar o link temporário em `<img>`, `PdfThumb`, pré-visualização e "abrir"; exclusão usa `documentPath(doc.file_url)`. Mostrar "Não foi possível abrir o arquivo" se o link não existir.
- [ ] **Step 4: Verificar** — testes PASS, `tsc`, `eslint` no arquivo.
- [ ] **Step 5: Commit** — `fix(documentos): bucket privado com links temporários`

---

### Task 7: Tela de despesas

**Files:**
- Create: `src/lib/livro-caixa/despesas.ts`, `src/components/financeiro/ListaDespesas.tsx`, `src/components/financeiro/ModalDespesa.tsx`
- Modify: `src/app/(dashboard)/financeiro/page.tsx` (aba `despesas`, rótulo "Despesas")
- Test: `tests/livro-caixa/despesas.test.ts`

**Interfaces:**
- Consumes: Task 2 (`CATEGORIES`, `defaultGroup`, `groupLabel`, `monthRange`, `shiftMonth`, `monthLabel`), `parseReaisInput`, `toDbPaidAt`, `fromDbPaidAt`, `signedUrls` (Task 6).
- Produces (`despesas.ts`):
  - `export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024`
  - `export const RECEIPT_TYPES = ['image/jpeg','image/png','image/webp','application/pdf'] as const`
  - `export function checkReceiptFile(f: { size: number; type: string }): string | null` — erro `'Envie JPG, PNG, WEBP ou PDF de até 10 MB'` ou `null`.
  - `export interface ExpenseForm { description: string; amount: string; category: ExpenseCategory; deductionGroup: DeductionGroup | null; dueDate: string; paid: boolean; paidDate: string; paymentMethod: string; professionalId: string; notes: string }`
  - `export function validateExpense(f: ExpenseForm): { ok: true; row: { description: string; amount: number; category: ExpenseCategory; deduction_group: DeductionGroup | null; due_date: string | null; status: 'pending' | 'paid'; paid_at: string | null; payment_method: string | null; professional_id: string | null; notes: string | null } } | { ok: false; errors: Partial<Record<keyof ExpenseForm, string>> }` — descrição obrigatória (`'Informe a descrição'`), valor > 0 (`'Valor inválido'`), pago exige data (`'Informe a data do pagamento'`), não pago exige vencimento (`'Informe o vencimento'`); `paid_at = toDbPaidAt(paidDate)`.
  - `export function receiptStoragePath(clinicId: string, expenseId: string, fileName: string, uuid: string): string` — `<clinic>/<expense>/<uuid>.<ext minúscula>`.

Tela (spec §9 "Financeiro → Despesas"): lista filtrada por mês pela data de pagamento (pagas) ou vencimento (a pagar); `ModalDespesa` cria/edita; comprovante: grava a despesa, depois sobe o arquivo e atualiza `receipt_*`; se a subida falhar, mantém a despesa e mostra `'Comprovante não enviado. Tente anexar de novo.'`; trocar comprovante remove o arquivo antigo depois de subir o novo; excluir apaga o arquivo e depois a linha; "marcar como paga" pede a data (padrão hoje). Seleção de categoria preenche o grupo com `defaultGroup`; link "alterar" mostra um select com os 3 grupos + "Não dedutível". Input de arquivo com `accept` dos `RECEIPT_TYPES` e `capture="environment"`.

- [ ] **Step 1: Testes de `despesas.ts`** — `rejects file over 10 MB`, `rejects gif`, `accepts pdf`; `validateExpense` com cada erro; `paid expense gets noon utc paid_at`; `receiptStoragePath lowercases extension and uses uuid`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `despesas.ts` e as telas.** O painel atual do Financeiro continua lendo despesas como antes.
- [ ] **Step 4: Verificar** — testes PASS, `tsc`, `eslint` nos arquivos, `npm run build`.
- [ ] **Step 5: Commit** — `feat(livro-caixa): cadastro de despesas com comprovante`

---

### Task 8: Tela do livro-caixa e responsável pelo pagamento

**Files:**
- Create: `src/components/financeiro/LivroCaixa.tsx`
- Modify: `src/app/(dashboard)/financeiro/page.tsx` (aba `livro`, rótulo "Livro-caixa"), `src/components/paciente/ModalEditarPaciente.tsx`, `src/app/(dashboard)/pacientes/[id]/page.tsx` (mostrar o responsável, se houver)

**Interfaces:**
- Consumes: rotas da Task 5 (`Ledger` como JSON), Task 2 (`shiftMonth`, `monthLabel`, `groupLabel`), `fromCents`, `formatCurrency` de `src/lib/utils`, `normalizeCpf`.

Tela (spec §9 "Financeiro → Livro-caixa"): seletor de mês; quadro com Receitas de pacientes, Despesas de custeio (com a linha "Tarifas de cobrança (Asaas)" quando > 0), Salários e encargos, Emolumentos, Resultado do mês, e informativos (Recebimentos de convênios, Despesas não dedutíveis); aviso fixo; alertas (só os > 0): `N recibo(s) do Receita Saúde pendente(s)`, `N pagamento(s) sem CPF do pagador`, `N despesa(s) dedutível(is) sem comprovante`; lista de recibos com copiar CPF (só dígitos) e copiar valor (`1234,56`), "Marcar como emitido"/"Desfazer" (atualização otimista, desfaz se a rota falhar e mostra o erro), filtro "Só pendentes", sem CPF → "Sem CPF" + link `/pacientes/<id>`; botão "Baixar pacote do contador" (fetch do zip → download; se header `X-Comprovantes-Omitidos`, aviso `'Os comprovantes passam de 100 MB e ficaram fora do pacote.'`).

Paciente: seção "Responsável pelo pagamento (opcional)" com nome e CPF; CPF preenchido e inválido bloqueia salvar com `'CPF inválido'`; grava `payer_cpf` só com dígitos; CPF vazio grava `null` nos dois campos se o nome também estiver vazio.

- [ ] **Step 1: Implementar a tela e o cadastro.**
- [ ] **Step 2: Verificar** — `tsc`, `eslint` nos arquivos, `npm run build`, `npx vitest run` (suíte inteira PASS).
- [ ] **Step 3: Commit** — `feat(livro-caixa): tela do livro-caixa e responsável pelo pagamento`

---

### Task 9: Documentação e teste com o usuário

**Files:**
- Modify: `README.md` (seção "Livro-caixa e Carnê-Leão": aplicar a migração, o que o app faz e não faz, aviso de conferência, confirmar com o contador a dedução das tarifas)

- [ ] **Step 1: Escrever a seção do README.**
- [ ] **Step 2: Verificação final** — `npx vitest run`, `npx tsc --noEmit -p .`, `npm run build`, árvore limpa.
- [ ] **Step 3: Commit** — `docs: livro-caixa e Carnê-Leão`
- [ ] **Step 4: Teste com o usuário** (controlador, não subagente): aplicar `supabase/2026-11-05-livro-caixa.sql`; documentos antigos do paciente abrem; despesa com foto pelo celular; resumo de novembro com os pagamentos dos testes do Asaas (tarifas aparecem); marcar/desfazer recibo; responsável pelo pagamento muda o pagador; pacote baixa e a planilha abre no Excel com acentos e colunas certas.
