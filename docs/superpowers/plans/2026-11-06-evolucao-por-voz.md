# Evolução clínica e anamnese por voz (IA): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dentista grava ou dita a evolução e a anamnese; a OpenAI transcreve e organiza; o app sugere ações (orçamento, tratamentos, odontograma, retorno) que são aplicadas de uma vez ao salvar.

**Architecture:** Toda chamada à OpenAI passa por `src/lib/ia/openai.ts` (cliente injetável). Regras puras em `src/lib/ia/**` (ficha resumida com apelidos, validação de sugestões e de respostas, uso do mês). Rotas autenticadas em `src/app/api/ia/*` e `src/app/api/evolucoes`; a gravação da evolução com as ações é uma função SQL transacional chamada com service role. Um componente `BarraVoz` (Gravar/Ditar) é compartilhado pela evolução e pela anamnese.

**Tech Stack:** Next.js 16 (route handlers), React 19, Supabase (Postgres, RLS, função SQL), Vitest, pacote `openai` (Responses API + transcrição), `zod` 4, Web Speech API, MediaRecorder.

**Spec:** `docs/superpowers/specs/2026-11-06-evolucao-por-voz-design.md`

## Global Constraints

- Next.js 16: antes de escrever route handlers ou páginas, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `page.md`. Antes da Task 5, procurar em `node_modules/next/dist/docs/` o limite de corpo do `proxy` (`proxyClientMaxBodySize` ou equivalente) e garantir que um áudio de 10 min passa (ver Task 5).
- Rotas autenticadas: `getCurrentClinic()`; 401 `{ error: 'Não autorizado.' }`; 500 `{ error: 'Erro interno. Tente novamente.' }` com `console.error('[ia/<rota>] ...')`; `export const dynamic = 'force-dynamic'`; `createAdminClient()` e sempre filtrar por `clinic_id`; id que não é UUID → 422.
- **Só `src/lib/ia/openai.ts` importa o pacote `openai`.** Nenhum log com chave, texto, áudio ou dado do paciente.
- Modelos e limites só em `src/lib/ia/modelos.ts`: `TRANSCRIBE_MODEL = 'gpt-transcribe'` (com `languages: ['pt']`); `TEXT_MODELS = { economico: 'gpt-6-luna', caprichado: 'gpt-6.1-terra' }`; preços US$ `transcrição 0.0045/min`, `gpt-6-luna 0.10/0.50`, `gpt-6.1-terra 1/5` por MTok; `MAX_AUDIO_BYTES = 25 * 1024 * 1024`; `MAX_AUDIO_SECONDS = 600`; `MAX_TEXT_CHARS = 20000`; `AI_TIMEOUT_MS = 60000`.
- Sem chave: 409 `{ error: 'Cadastre a chave da OpenAI em Configurações → Inteligência artificial' }`.
- Mensagens de erro de IA (exatas): `invalid_key` "A chave da OpenAI foi recusada. Confira em Configurações." (422); `rate_limited` "A conta da OpenAI atingiu o limite. Tente mais tarde." (429); `unavailable`/`timeout`/`bad_output` "Não foi possível organizar agora. Tente de novo." (503); microfone negado "Permita o uso do microfone no navegador.".
- Ficha enviada à IA nunca contém nome, CPF, telefone, e-mail, endereço, nascimento, idade ou sexo.
- Dentes FDI válidos: 11–18, 21–28, 31–38, 41–48, 51–55, 61–65, 71–75, 81–85. Faces: `V M O D L`.
- Migração `supabase/2026-11-06-evolucao-por-voz.sql` re-executável, espelhada em `supabase/schema.sql`.
- Texto em português do Brasil; estilo das telas atuais (`#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).

## Review Focus

1. **iPhone grava em `audio/mp4`** (às vezes `video/mp4`) e o Chrome em `audio/webm;codecs=opus`: a rota precisa aceitar todos e mandar à OpenAI com extensão coerente. → Task 5 (`aceita mp4 do Safari`).
2. **Item concluído por outra pessoa entre "Organizar" e "Salvar":** nada é gravado e aparece a mensagem do banco. → Task 1 (função aborta) e Task 5 (`erro do banco vira 409 com a mensagem`).
3. **Paciente de outra clínica** no organizar/salvar: 404, sem vazar nada. → Task 4 (`ficha null para paciente de outra clínica`) e Task 5.
4. **Navegador sem Web Speech API** (Firefox) ou sem MediaRecorder: botão some, sem erro. → Task 6 (`getSpeechRecognition devolve null`).
5. **Chave nunca volta ao navegador:** a resposta do GET só tem os 4 últimos dígitos. → Task 3 (`view não contém api_key`).

---

## File Structure

```
supabase/2026-11-06-evolucao-por-voz.sql      (novo) migração
supabase/schema.sql                           (mod) espelho
src/types/index.ts                            (mod) AiTier, ai_used em Evolution/Anamnesis
src/lib/ia/modelos.ts                         (novo) modelos, preços, limites
src/lib/ia/erros.ts                           (novo) AiError, mensagens, status HTTP
src/lib/ia/openai.ts                          (novo) único cliente da OpenAI
src/lib/ia/uso.ts                             (novo) resumo do mês (puro)
src/lib/ia/conexao.ts                         (novo) salvar/remover chave, view pública
src/lib/ia/repo.ts                            (novo) Supabase: conexão, uso
src/lib/ia/rotas.ts                           (novo) handler comum das rotas de IA
src/lib/ia/texto.ts                           (novo) appendText (puro)
src/lib/ia/evolucao/{ficha,esquema,sugestoes,salvar,repo}.ts   (novo)
src/lib/ia/anamnese/{esquema,respostas}.ts    (novo)
src/app/api/ia/conexao/route.ts               (novo) GET/PUT/DELETE
src/app/api/ia/transcrever/route.ts           (novo)
src/app/api/ia/evolucao/organizar/route.ts    (novo)
src/app/api/ia/anamnese/preencher/route.ts    (novo)
src/app/api/evolucoes/route.ts                (novo) salvar com ações
src/app/(dashboard)/configuracoes/ia/page.tsx (novo) + card em configuracoes/page.tsx
src/components/ia/{BarraVoz,ListaSugestoes}.tsx, useIaStatus.ts, fala.ts   (novo)
src/components/agenda/ModalEvolucao.tsx       (mod)
src/components/agenda/ModalNovaConsulta.tsx   (mod) initialPatientId, initialNotes
src/app/(dashboard)/agenda/page.tsx           (mod) abre retorno
src/components/paciente/TabAnamneses.tsx      (mod)
README.md, .env.example                       (mod)
```

---

### Task 1: Banco de dados e tipos

**Files:**
- Create: `supabase/2026-11-06-evolucao-por-voz.sql`
- Modify: `supabase/schema.sql`, `src/types/index.ts`
- Test: `tests/supabase/migration.test.ts` (novo bloco `evolucao-por-voz`, para o arquivo novo e `schema.sql`)

**Interfaces:**
- Produces: tabelas `ai_connections`, `ai_usage`; colunas `evolutions.ai_used`, `anamneses.ai_used`; função `public.save_evolution_with_actions(p_clinic_id uuid, p_patient_id uuid, p_appointment_id uuid, p_professional_id uuid, p_date date, p_description text, p_images text[], p_ai_used boolean, p_actions jsonb) RETURNS uuid`; tipos TS `AiTier = 'economico' | 'caprichado'`, `ai_used: boolean` nas interfaces de evolução e anamnese existentes.
- Formato de `p_actions` (array JSON): `{ "tipo": "item_orcamento", "id": uuid, "novo_status": "in_progress"|"completed" }`, `{ "tipo": "tratamento", "id": uuid, "novo_status": "in_progress"|"completed" }`, `{ "tipo": "tratamento_novo", "procedimento": text, "dentes": int[], "faces": text[], "status": "completed"|"planned" }`.

- [ ] **Step 1: Testes da migração** (texto do SQL): SQL de tabelas/colunas exatamente como na spec §Banco; `ENABLE ROW LEVEL SECURITY` nas duas tabelas e nenhum `CREATE POLICY` com `ON ai_connections` ou `ON ai_usage`; `CHECK (kind IN ('transcricao','evolucao','anamnese'))`; `CHECK (model_tier IN ('economico','caprichado'))`; `CREATE OR REPLACE FUNCTION public.save_evolution_with_actions`; `SECURITY DEFINER`; `REVOKE ALL ON FUNCTION public.save_evolution_with_actions` de `PUBLIC, anon, authenticated` e `GRANT EXECUTE ... TO service_role`; `set_config('app.budget_system', 'on', true)`; `ADD COLUMN IF NOT EXISTS ai_used`.
- [ ] **Step 2: Rodar** `npx vitest run tests/supabase/migration.test.ts` → FAIL.
- [ ] **Step 3: Escrever a migração** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). A função, numa transação, na ordem:
  1. paciente pertence a `p_clinic_id`; `p_appointment_id` (se não nulo) é da clínica e do paciente; `p_professional_id` (se não nulo) é da clínica → senão `RAISE EXCEPTION 'Paciente ou consulta inválidos'`;
  2. `PERFORM set_config('app.budget_system', 'on', true)`;
  3. para cada ação `item_orcamento`: `SELECT ... FOR UPDATE` do item juntando `budgets` (mesma clínica, `budgets.patient_id = p_patient_id`, `budgets.status = 'approved'`, `budget_items.approved = true`); o status novo precisa avançar (`pending < in_progress < completed`) → senão `RAISE EXCEPTION 'O item % já foi concluído ou mudou. Organize de novo.'` com o procedimento; atualiza; se todos os itens `approved = true` do orçamento ficaram `completed`, `UPDATE budgets SET status = 'completed'`;
  4. `tratamento`: mesma ideia em `treatments` (clínica e paciente; `planned < in_progress < completed`; `cancelled` nunca muda) com `'O tratamento % já foi concluído ou mudou. Organize de novo.'`;
  5. `tratamento_novo`: insere `treatments` (`value = 0`, `date = p_date`, `professional_id = p_professional_id`, `status` da ação) e uma linha de `treatment_teeth` por dente com as `faces`;
  6. insere a evolução (`images = coalesce(p_images, '{}')`, `ai_used = p_ai_used`) e devolve o id.
- [ ] **Step 4: Espelhar em `schema.sql`** e atualizar `src/types/index.ts`.
- [ ] **Step 5: Rodar** migração + `npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** `feat(ia): migração da evolução e anamnese por voz`.

### Task 2: Cliente OpenAI, modelos e erros

**Files:**
- Create: `src/lib/ia/modelos.ts`, `src/lib/ia/erros.ts`, `src/lib/ia/openai.ts`
- Modify: `package.json` (`npm install openai`, versão atual)
- Test: `tests/ia/openai.test.ts`, `tests/ia/erros.test.ts`

**Interfaces:**
- Produces:
  - `modelos.ts`: constantes da Global Constraints; `PRICES_USD: { transcribePerMinute: number; text: Record<string, { input: number; output: number }> }` (por MTok).
  - `erros.ts`: `type AiErrorKind = 'invalid_key' | 'rate_limited' | 'unavailable' | 'timeout' | 'bad_output'`; `class AiError extends Error { kind: AiErrorKind }`; `aiErrorResponse(kind): { status: number; error: string }` (valores da Global Constraints); `NO_KEY_ERROR = { status: 409, error: 'Cadastre a chave da OpenAI em Configurações → Inteligência artificial' }`.
  - `openai.ts`: `interface AiClient { transcribe(audio: File): Promise<string>; organize<T>(args: { model: string; schema: z.ZodType<T>; name: string; system: string; user: string }): Promise<{ data: T; inputTokens: number; outputTokens: number }>; testKey(): Promise<void> }`; `makeAiClient(apiKey: string, sdk?: OpenAI): AiClient`; `toAiError(e: unknown): AiError`.
- Decisões:
  - `new OpenAI({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 })`.
  - `transcribe`: `audio.transcriptions.create({ model: TRANSCRIBE_MODEL, file, languages: ['pt'] })`; se a versão instalada do SDK não tipar `languages`, passar mesmo assim (cast) — a doc oficial da OpenAI o define para `gpt-transcribe`.
  - `organize`: `responses.parse` com `zodTextFormat(schema, name)` de `openai/helpers/zod`. Se o helper não aceitar zod 4 na versão instalada, usar `text.format = { type: 'json_schema', name, strict: true, schema: z.toJSONSchema(schema) }` e validar com `schema.safeParse(JSON.parse(output_text))`. Saída nula ou que não passa no schema → `AiError('bad_output')`. Tokens de `response.usage`.
  - `testKey`: `models.list()` (primeira página).
  - `toAiError`: `AuthenticationError`/`PermissionDeniedError` → `invalid_key`; `RateLimitError` (inclui `insufficient_quota`) → `rate_limited`; `APIConnectionTimeoutError` → `timeout`; `APIConnectionError`, `InternalServerError` e outros `APIError` → `unavailable`; `AiError` passa direto; qualquer outro → `unavailable`.

- [ ] **Step 1: Testes** com SDK falso (objeto com `audio.transcriptions.create`, `responses.parse`, `models.list` como `vi.fn`): `transcribe` envia `model: 'gpt-transcribe'` e `languages: ['pt']` e devolve `text`; `organize` devolve `data` e tokens; saída nula → `bad_output`; `toAiError` para cada classe de erro do SDK (instanciar as classes exportadas por `openai`); `aiErrorResponse('invalid_key')` = `{ status: 422, error: 'A chave da OpenAI foi recusada. Confira em Configurações.' }` e os demais.
- [ ] **Step 2–4:** rodar `npx vitest run tests/ia` (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(ia): cliente da OpenAI, modelos e erros`.

### Task 3: Chave da clínica, uso do mês e Configurações

**Files:**
- Create: `src/lib/ia/uso.ts`, `src/lib/ia/conexao.ts`, `src/lib/ia/repo.ts`, `src/lib/ia/rotas.ts`, `src/app/api/ia/conexao/route.ts`, `src/app/(dashboard)/configuracoes/ia/page.tsx`
- Modify: `src/app/(dashboard)/configuracoes/page.tsx` (card "Inteligência artificial", id `ia`)
- Test: `tests/ia/uso.test.ts`, `tests/ia/conexao.test.ts`

**Interfaces:**
- Consumes: Task 2 (`AiClient`, `makeAiClient`, `AiError`, `aiErrorResponse`, `NO_KEY_ERROR`, `TEXT_MODELS`, `PRICES_USD`).
- Produces:
  - `uso.ts`: `type UsageRow = { kind: 'transcricao' | 'evolucao' | 'anamnese'; model: string; audio_seconds: number | null; input_tokens: number | null; output_tokens: number | null; ok: boolean }`; `summarizeUsage(rows: UsageRow[]): { audioMinutes: number; transcricoes: number; evolucoes: number; anamneses: number; estimatedUsd: number }` (contagens só de `ok`; custo soma todas as linhas: minutos × preço + tokens × preço do modelo; modelo sem preço conta 0; `audioMinutes` com 1 casa, `estimatedUsd` com 2); `monthStartIso(now: Date): string` (1º dia do mês em `America/Sao_Paulo`, em ISO UTC).
  - `conexao.ts`: `interface AiDeps { getStored(clinicId): Promise<{ api_key: string; api_key_last4: string; model_tier: AiTier } | null>; save(row: { clinic_id; api_key; api_key_last4; model_tier; updated_at }): Promise<void>; remove(clinicId): Promise<void>; listUsage(clinicId, fromIso): Promise<UsageRow[]>; makeClient(apiKey): AiClient }`; `saveAiConnection(clinicId, input: { apiKey?: unknown; modelTier?: unknown }, deps): Promise<{ ok: true } | { ok: false; status: number; error: string }>`; `getAiForClinic(clinicId, deps): Promise<{ client: AiClient; model: string } | null>`; `getAiView(clinicId, deps, now): Promise<{ conectado: boolean; last4: string | null; modelTier: AiTier; usoMes: ReturnType<typeof summarizeUsage> }>`.
  - Regras de `saveAiConnection`: `apiKey` com trim; vazio/ausente só é válido se já existe conexão (troca só de modelo); `modelTier` fora da lista → 422 "Modelo inválido"; chave nova → `testKey()`; `invalid_key` → 422 "Chave inválida"; outro erro → `aiErrorResponse`; sem chave e sem conexão → 422 "Informe a chave da OpenAI".
  - `repo.ts`: `createAiDeps(admin): AiDeps`; `recordUsage(admin, clinicId, userId, row: UsageRow): Promise<void>` (falha só gera `console.error`, nunca derruba a rota).
  - `rotas.ts`: `withClinic(label: string, run: (ctx: { clinicId: string; userId: string; admin }) => Promise<{ status: number; body: unknown }>): Promise<NextResponse>` (401/500 da Global Constraints; `AiError` → `aiErrorResponse`); `isUuid(s: unknown): s is string`.
- Página: campo de chave (tipo senha), "Salvar", "Remover" (confirmação), seletor "Econômico (padrão)" / "Mais caprichado", mostra `sk-…{last4}`, quadro "Uso do mês" (minutos de áudio, organizações de evolução, preenchimentos de anamnese, custo estimado US$) e o aviso de LGPD da spec.

- [ ] **Step 1: Testes:** `summarizeUsage` (2 min de áudio + 1 evolução luna 4000/1500 tokens → custo `0.0090 + 0.00115` arredondado = 0.01; linhas `ok=false` não contam na contagem); `monthStartIso(new Date('2026-11-01T02:00:00Z'))` = `'2026-10-01T03:00:00.000Z'`; `saveAiConnection` chave inválida não chama `save`; chave válida grava `api_key_last4` = 4 últimos; troca só de modelo sem conexão → 422; modelo `'turbo'` → 422; `getAiView` — **`view não contém api_key`** (`JSON.stringify(view)` não contém a chave); `getAiForClinic` usa `TEXT_MODELS[model_tier]`.
- [ ] **Step 2–4:** rodar (FAIL), implementar (incluindo rota e página), rodar (PASS) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(ia): chave da OpenAI por clínica e uso do mês`.

### Task 4: Ficha resumida, esquema e sugestões da evolução (puro + leitura)

**Files:**
- Create: `src/lib/ia/evolucao/ficha.ts`, `esquema.ts`, `sugestoes.ts`, `repo.ts`
- Test: `tests/ia/ficha.test.ts`, `tests/ia/sugestoes.test.ts`, `tests/ia/esquemaEvolucao.test.ts`

**Interfaces:**
- Produces:
  - `type FichaInput = { treatments: { id; procedure; status: 'planned' | 'in_progress'; date: string; teeth: { tooth_number: number; faces: string[] }[] }[]; budgetItems: { id; procedure; tooth: string | null; status: 'pending' | 'in_progress'; budget_date: string }[] }`.
  - `type Ref = { kind: 'item' | 'tratamento'; id: string; status: string; label: string; budgetDate?: string }`.
  - `buildFicha(input: FichaInput, today: string): { texto: string; refs: Map<string, Ref> }` — no máximo 50 de cada, mais recentes primeiro; apelidos `T1..`, `O1..`; uma linha por item, ex.: `T1 | Restauração | dentes 36 (M,O) | planejado` e `O1 | Canal | dente 46 | pendente | orçamento de 12/10/2026`; primeira linha `Hoje: 06/11/2026`; `label` = procedimento + dentes e faces juntas (`Restauração 36 MO`).
  - `loadFichaInput(admin, clinicId, patientId): Promise<FichaInput | null>` (null se o paciente não é da clínica; itens só de orçamentos `approved` com `approved = true` e status `pending`/`in_progress`).
  - `esquema.ts`: `EvolucaoOutputSchema` (zod) = `{ secoes: { motivo; procedimentos; observacoes; proximos_passos: string | null }, sugestoes: { tipo: enum('item_orcamento','tratamento','tratamento_novo','retorno'); ref: string | null; novo_status: enum('in_progress','completed') | null; procedimento: string | null; dentes: number[] | null; faces: string[] | null; status: enum('completed','planned') | null; dias: number | null; motivo: string | null }[] }` (todos os campos obrigatórios e anuláveis, compatível com modo estrito); `EVOLUCAO_SYSTEM: string` (regras da spec §Resposta da IA); `montarTexto(secoes): string` — blocos `Título\ntexto` separados por linha em branco, títulos `Motivo`, `Procedimentos realizados`, `Observações`, `Próximos passos`, seções nulas/vazias omitidas.
  - `sugestoes.ts`: `type Acao = { tipo: 'item_orcamento' | 'tratamento'; id: string; novo_status: 'in_progress' | 'completed' } | { tipo: 'tratamento_novo'; procedimento: string; dentes: number[]; faces: string[]; status: 'completed' | 'planned' } | { tipo: 'retorno'; dias: number; motivo: string }`; `type Sugestao = { acao: Acao; descricao: string }`; `validarSugestoes(raw, refs): Sugestao[]` (regras da spec §Validação); `isFdi(n: number): boolean`; `normalizarFaces(f: string[]): string[] | null` (maiúsculas, sem repetição, null se alguma fora de `V M O D L`); `dataRetorno(dataEvolucao: 'YYYY-MM-DD', dias: number): 'YYYY-MM-DD'`.
  - Descrições: `Concluir Restauração 36 MO (orçamento de 12/10/2026)`, `Iniciar …`, `Concluir tratamento Canal 46`, `Marcar em andamento: …`, `Lançar tratamento: Profilaxia (concluído)` / `… — 46 O (planejado)`, `Retorno em 15 dias: remover a sutura`.

- [ ] **Step 1: Testes:**
  - `ficha`: nenhum campo além dos de `FichaInput` aparece (montar a entrada com um objeto que também tem `name`, `cpf`, `phone` e checar que `texto` não contém esses valores); apelidos estáveis na ordem; 60 tratamentos → 50; `refs.get('O1').id` correto; `label` `Restauração 36 MO`.
  - `sugestoes`: descarta ref inexistente; `O1` com tipo `tratamento`; `completed` → `in_progress`; mesmo status; dente 19 e 99; face `X`; procedimento vazio; procedimento com 300 caracteres → corta em 200; `dias` 0 e 400; segundo retorno; ref repetida (fica a primeira); traduz para UUID; descrições exatas acima; `dataRetorno('2026-12-25', 15)` = `'2027-01-09'`.
  - `esquema`: `montarTexto` com `observacoes: null` omite o bloco; todas nulas → `''`.
  - **`ficha null para paciente de outra clínica`**: `loadFichaInput` com admin falso cujo paciente retorna vazio → `null`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(ia): ficha resumida e sugestões da evolução`.

### Task 5: Rotas de transcrição, organização e salvamento

**Files:**
- Create: `src/app/api/ia/transcrever/route.ts`, `src/app/api/ia/evolucao/organizar/route.ts`, `src/app/api/evolucoes/route.ts`, `src/lib/ia/evolucao/salvar.ts`, `src/lib/ia/audio.ts`
- Test: `tests/ia/audio.test.ts`, `tests/ia/salvar.test.ts`, `tests/ia/organizar.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (`withClinic`, `isUuid`, `getAiForClinic`, `createAiDeps`, `recordUsage`, `NO_KEY_ERROR`, `loadFichaInput`, `buildFicha`, `EvolucaoOutputSchema`, `EVOLUCAO_SYSTEM`, `montarTexto`, `validarSugestoes`, `Acao`).
- Produces:
  - `audio.ts`: `checkAudio(file: { size: number; type: string } | null, seconds: number): { ok: true; ext: 'webm' | 'mp4' | 'm4a' | 'mp3' | 'wav' | 'ogg' } | { ok: false; status: 413 | 422; error: string }` — tipo pela parte antes do `;`; aceita `audio/webm`, `audio/mp4`, `video/mp4` (→ `mp4`), `audio/x-m4a`/`audio/m4a`, `audio/mpeg`, `audio/wav`, `audio/ogg`; > `MAX_AUDIO_BYTES` ou `seconds > MAX_AUDIO_SECONDS + 5` → 413 "Áudio longo demais (máximo 10 minutos)"; vazio ou tipo desconhecido → 422 "Áudio inválido". A rota renomeia o arquivo para `audio.<ext>` antes de enviar.
  - `POST /api/ia/transcrever`: multipart `audio`, `seconds` → `{ texto }`; registra uso `transcricao` com `audio_seconds = ceil(seconds)` (e `ok=false` em falha).
  - `POST /api/ia/evolucao/organizar` `{ patientId, texto }` → `{ texto: string; secoes; sugestoes: Sugestao[] }`; texto vazio ou > `MAX_TEXT_CHARS` → 422 "Texto vazio ou longo demais"; ficha null → 404 "Paciente não encontrado"; user da IA = `Ficha do paciente:\n{ficha}\n\nTexto do atendimento:\n{texto}`; registra uso `evolucao`.
  - `salvar.ts`: `parseSalvarEvolucao(body: unknown): { ok: true; input: SalvarInput } | { ok: false; status: 422; error: string }` com `SalvarInput = { patientId; appointmentId: string | null; professionalId: string | null; date: string; description: string; images: string[]; aiUsed: boolean; acoes: Exclude<Acao, { tipo: 'retorno' }>[] }` (UUIDs, data válida, descrição com trim não vazia e ≤ `MAX_TEXT_CHARS`, ações revalidadas com `isFdi`/`normalizarFaces`, `retorno` descartado); `salvarEvolucao(clinicId, input, deps: { rpc(args): Promise<{ data: string | null; error: { code?: string; message: string } | null }> }): Promise<{ status: number; body: unknown }>` → 200 `{ id }`; erro com `code === 'P0001'` → 409 `{ error: message }`; outro → lança.
  - `POST /api/evolucoes`: usa as duas funções acima.
  - **Limite do proxy:** gravação com `audioBitsPerSecond: 32000` (Task 6) dá ~2,4 MB em 10 min; se a doc do Next indicar limite de corpo menor que 25 MB para rotas que passam pelo `src/proxy.ts`, configurar em `next.config.ts` o valor `'26mb'` com comentário.

- [ ] **Step 1: Testes:** `checkAudio` — **`aceita mp4 do Safari`** (`'audio/mp4'` e `'video/mp4'` → `mp4`), `'audio/webm;codecs=opus'` → `webm`, 26 MB → 413, `seconds = 700` → 413, `'text/plain'` → 422; `parseSalvarEvolucao` — UUID inválido → 422, descrição só espaços → 422, ação com dente 19 → 422 "Sugestão inválida", `retorno` sai das ações; `salvarEvolucao` — **`erro do banco vira 409 com a mensagem`** (`{ code: 'P0001', message: 'O item Canal já foi concluído ou mudou. Organize de novo.' }` → 409 com a mesma mensagem), sucesso → `{ id }`, argumentos do rpc com nomes `p_clinic_id`… e `p_actions` igual às ações; organizar — texto de 20001 caracteres → 422 (testar a função de validação exportada pela rota em `salvar.ts` ou numa `parseOrganizar(body)` no mesmo arquivo).
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(ia): rotas de transcrição, organização e salvamento`.

### Task 6: Barra de voz e janela de evolução

**Files:**
- Create: `src/components/ia/BarraVoz.tsx`, `src/components/ia/ListaSugestoes.tsx`, `src/components/ia/useIaStatus.ts`, `src/components/ia/fala.ts`, `src/lib/ia/texto.ts`
- Modify: `src/components/agenda/ModalEvolucao.tsx`, `src/components/agenda/ModalNovaConsulta.tsx`, `src/app/(dashboard)/agenda/page.tsx`
- Test: `tests/ia/texto.test.ts`, `tests/ia/fala.test.ts`

**Interfaces:**
- Consumes: Task 5 (rotas e formatos), Task 4 (`Sugestao`, `dataRetorno`).
- Produces:
  - `texto.ts`: `appendText(atual: string, novo: string): string` (trim do novo; vazio → atual; atual vazio → novo; senão junta com um espaço, ou sem espaço se o atual termina em quebra de linha).
  - `fala.ts`: `getSpeechRecognition(w: unknown): (new () => SpeechRecognitionLike) | null` (usa `SpeechRecognition` ou `webkitSpeechRecognition`; null se nenhum); `pickRecorderMime(isSupported: (m: string) => boolean): string | null` (ordem `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`; null se nenhum).
  - `useIaStatus(): { conectado: boolean; carregando: boolean }` (GET `/api/ia/conexao`).
  - `BarraVoz` props `{ gravarDisponivel: boolean; onTexto(t: string): void; disabled?: boolean }`: "Ditar" (só se `getSpeechRecognition(window)`), `lang='pt-BR'`, `continuous`, `interimResults`; parcial mostrado numa linha cinza abaixo; final → `onTexto`; ao parar sozinho volta ao estado inicial. "Gravar" (só se `gravarDisponivel` e `pickRecorderMime` não nulo): `MediaRecorder` com `audioBitsPerSecond: 32000`, contador mm:ss, para em 600 s, envia multipart (`audio`, `seconds`), mostra "Transcrevendo…", `onTexto(texto)`; erros em vermelho (inclusive "Permita o uso do microfone no navegador."); descarta os pedaços de áudio após enviar.
  - `ListaSugestoes` props `{ sugestoes: Sugestao[]; marcadas: boolean[]; onToggle(i: number): void }`.
  - `ModalEvolucao`: barra acima do campo; "Organizar com IA" (só com `conectado` e texto) → substitui o texto, guarda o original para "Desfazer", mostra sugestões **todas marcadas**; botão "Salvar" vira "Salvar e aplicar N sugestões"; salva por `POST /api/evolucoes` (sempre, com ou sem IA; `aiUsed` true se organizou); `onSaved(retorno: { data: string; motivo: string } | null)`.
  - `ModalNovaConsulta`: props novas `initialPatientId?: string`, `initialNotes?: string`.
  - Agenda: `onSaved` com retorno abre `ModalNovaConsulta` com `initialDate` = data do retorno, `initialPatientId`, `initialProfessionalId` da consulta e `initialNotes` = `Retorno: {motivo}`.

- [ ] **Step 1: Testes:** `appendText('', ' oi ')` = `'oi'`; `appendText('a', 'b')` = `'a b'`; `appendText('a\n', 'b')` = `'a\nb'`; `appendText('a', '  ')` = `'a'`; **`getSpeechRecognition devolve null`** para `{}`; devolve `webkitSpeechRecognition` quando só ele existe; `pickRecorderMime(m => m === 'audio/mp4')` = `'audio/mp4'`; nenhum → null.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** `feat(ia): barra de voz e evolução com sugestões`.

### Task 7: Anamnese por voz

**Files:**
- Create: `src/lib/ia/anamnese/esquema.ts`, `src/lib/ia/anamnese/respostas.ts`, `src/app/api/ia/anamnese/preencher/route.ts`
- Modify: `src/components/paciente/TabAnamneses.tsx`
- Test: `tests/ia/anamnese.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6 (`BarraVoz`, `useIaStatus`, `appendText`, `withClinic`, `getAiForClinic`, `recordUsage`).
- Produces:
  - `type Pergunta = { id: string; text: string; type: 'text' | 'yesno' | 'options'; options?: string[] }`.
  - `AnamneseOutputSchema` = `{ respostas: { id: string; valor: string | null }[]; observacoes: string | null }`; `ANAMNESE_SYSTEM` (não chutar; detalhes nas observações; Sim/Não; só opções da lista); `perguntasTexto(ps: Pergunta[]): string` (linha por pergunta: `id | tipo | texto | opções: a; b`).
  - `validarRespostas(raw, perguntas): { respostas: Record<string, string>; observacoes: string | null }` — `yesno`: `sim`/`não`/`nao` (sem acento e maiúsculas) → `Sim`/`Não`, outro → ignora; `options`: compara sem acento/maiúsculas/espaços nas pontas e grava a grafia cadastrada; `text`: trim, até 500; `id` desconhecido ou `null`/vazio → ignora; `observacoes` trim, vazio → null, até 2000.
  - `mesclarAnamnese(atual: Record<string, string>, notas: string, ia): { answers: Record<string, string>; notes: string; preenchidas: string[] }` — só ids sem resposta atual (vazio/espaços conta como sem resposta); `notes` = `appendText` com quebra de linha (`notas ? notas + '\n' + obs : obs`).
  - `POST /api/ia/anamnese/preencher` `{ templateId, texto }` → `{ respostas, observacoes }`; modelo de outra clínica → 404 "Modelo de anamnese não encontrado"; texto vazio/longo → 422; registra uso `anamnese`.
  - `TabAnamneses`: barra de voz + campo + "Preencher com IA" (só com `conectado` e modelo escolhido); marca "IA" ao lado das perguntas preenchidas, que some quando o usuário muda a resposta; insert com `ai_used: preenchidas.length > 0 || observações vieram da IA`.

- [ ] **Step 1: Testes:** `'sim'` → `Sim`; `'NAO'` → `Não`; `'talvez'` em yesno → ignora; opção `'hipertensao'` casa com `'Hipertensão'`; opção fora da lista → ignora; id desconhecido → ignora; texto com 600 → 500; mesclar não sobrescreve `{ q1: 'Não' }`; mesclar preenche `{ q2: '  ' }`; notas `'A'` + obs `'B'` → `'A\nB'`; notas vazias → `'B'`; `preenchidas` lista só as novas.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** `feat(ia): anamnese por voz`.

### Task 8: Documentação e teste com o usuário

**Files:**
- Modify: `README.md` (seção "Evolução e anamnese por voz": cadastrar a chave da OpenAI, aceitar o DPA na conta da OpenAI, orientar a menção ao uso de IA no termo da clínica, custo estimado, rodar `supabase/2026-11-06-evolucao-por-voz.sql`), `.env.example` (nada novo — confirmar; a chave é por clínica).

- [ ] **Step 1:** README.
- [ ] **Step 2: Rodar** `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build` → tudo verde.
- [ ] **Step 3: Commit** `docs: evolução e anamnese por voz`.
- [ ] **Step 4: Roteiro de teste manual** para o usuário (rodar o SQL; cadastrar chave inválida e válida; gravar no iPhone pelo túnel e no computador; ditar; organizar; salvar com sugestões; conferir odontograma, item e orçamento concluído; abrir retorno; anamnese sem sobrescrever; uso do mês).
